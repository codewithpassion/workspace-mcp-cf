// Google Tasks tools — 6 tools for the `gtasks` service.
//
// Module pattern (same for all 12 service modules):
//   import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//   import { z } from "zod";
//   import { googleApiFetch, type ToolContext } from "../google-service";
//   export function register(server: McpServer, ctx: ToolContext): void { ... }
//
// REST API base: https://tasks.googleapis.com/tasks/v1

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── API base URL ──────────────────────────────────────────────────────────────

const TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";

// ─── Authenticated fetch helper ───────────────────────────────────────────────

const tasksFetch = googleApiFetch;

// ─── URL builder ──────────────────────────────────────────────────────────────

function buildUrl(
	base: string,
	params: Record<string, string | number | boolean | null | undefined>,
): string {
	const url = new URL(base);
	for (const [k, v] of Object.entries(params)) {
		if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
	}
	return url.toString();
}

// ─── Response type interfaces ─────────────────────────────────────────────────

interface TaskList {
	id?: string;
	title?: string;
	updated?: string;
	selfLink?: string;
}

interface TaskListsResponse {
	items?: TaskList[];
	nextPageToken?: string;
}

interface Task {
	id?: string;
	title?: string;
	status?: string;
	due?: string;
	notes?: string;
	updated?: string;
	completed?: string;
	parent?: string;
	position?: string;
	selfLink?: string;
	webViewLink?: string;
}

interface TasksResponse {
	items?: Task[];
	nextPageToken?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LIST_TASKS_MAX_RESULTS_DEFAULT = 20;
const LIST_TASKS_MAX_RESULTS_MAX = 10_000;

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validate that `due` is a full RFC 3339 datetime with a timezone offset.
 * Date-only strings ("YYYY-MM-DD") and offset-less datetimes are rejected
 * (the Google Tasks API requires a complete timestamp).
 */
function validateRfc3339Date(due: string): void {
	const errorMsg = `Invalid due date format. Expected RFC 3339 datetime (e.g., '2026-04-25T00:00:00Z'), got '${due}'`;
	if (!due.includes("T")) throw new Error(errorMsg);
	const hasZ = due.endsWith("Z");
	const hasOffset = /[+-]\d{2}:\d{2}$/.test(due);
	if (!hasZ && !hasOffset) throw new Error(errorMsg);
	const normalized = hasZ ? `${due.slice(0, -1)}+00:00` : due;
	if (Number.isNaN(new Date(normalized).getTime())) throw new Error(errorMsg);
}

/**
 * Bump `dueMax` by one day to compensate for the Tasks API treating it as an
 * exclusive upper bound (tasks due on the requested date would otherwise be missed).
 */
function adjustDueMaxForTasksApi(dueMax: string): string {
	try {
		const d = new Date(dueMax);
		if (Number.isNaN(d.getTime())) return dueMax;
		const adjusted = new Date(d.getTime() + 86_400_000);
		return adjusted.toISOString().replace(".000Z", "Z");
	} catch {
		return dueMax;
	}
}

// ─── Task hierarchy helpers ───────────────────────────────────────────────────
//
// Mirrors the Python StructuredTask / get_structured_tasks / sort_structured_tasks /
// serialize_tasks helpers from tasks_tools.py.
//
// Position values are up to 20 zero-padded digits (Python LIST_TASKS_MAX_POSITION =
// "99999999999999999999"), which exceeds Number.MAX_SAFE_INTEGER.  We use BigInt to
// avoid precision loss on large positions, faithfully replicating Python's arbitrary-
// precision integer sort.

class StructuredTask {
	id: string;
	title: string | undefined;
	status: string | undefined;
	due: string | undefined;
	notes: string | undefined;
	updated: string | undefined;
	completed: string | undefined;
	isPlaceholderParent: boolean;
	subtasks: StructuredTask[];

	constructor(task: Partial<Task>, isPlaceholderParent: boolean) {
		this.id = task.id ?? "";
		this.title = task.title;
		this.status = task.status;
		this.due = task.due;
		this.notes = task.notes;
		this.updated = task.updated;
		this.completed = task.completed;
		this.isPlaceholderParent = isPlaceholderParent;
		this.subtasks = [];
	}
}

function sortStructuredTasksRecursive(
	rootTask: StructuredTask,
	positionsById: Map<string, bigint>,
): void {
	rootTask.subtasks.sort((a, b) => {
		const pa = positionsById.get(a.id);
		const pb = positionsById.get(b.id);
		// Tasks without a position sort to the end (mirrors Python's float("inf"))
		if (pa === undefined && pb === undefined) return 0;
		if (pa === undefined) return 1;
		if (pb === undefined) return -1;
		return pa < pb ? -1 : pa > pb ? 1 : 0;
	});
	for (const subtask of rootTask.subtasks) {
		sortStructuredTasksRecursive(subtask, positionsById);
	}
}

function getStructuredTasks(tasks: Task[]): StructuredTask[] {
	const tasksById = new Map<string, StructuredTask>();
	const positionsById = new Map<string, bigint>();

	for (const task of tasks) {
		if (!task.id) continue;
		tasksById.set(task.id, new StructuredTask(task, false));
		if (task.position) {
			try {
				positionsById.set(task.id, BigInt(task.position));
			} catch {
				// Non-integer position string — skip; task sorts to end
			}
		}
	}

	const rootTask = new StructuredTask({ id: "root", title: "Root" }, false);

	for (const task of tasks) {
		if (!task.id) continue;
		const structuredTask = tasksById.get(task.id);
		if (!structuredTask) continue;

		const parentId = task.parent;
		if (!parentId) {
			rootTask.subtasks.push(structuredTask);
		} else {
			const parent = tasksById.get(parentId);
			if (parent) {
				parent.subtasks.push(structuredTask);
			} else {
				// Orphaned subtask: parent was not returned (pagination / filtering / deleted).
				// Create a placeholder parent so hierarchy is preserved.
				let placeholder = tasksById.get(parentId);
				if (!placeholder) {
					placeholder = new StructuredTask({ id: parentId }, true);
					tasksById.set(parentId, placeholder);
					rootTask.subtasks.push(placeholder);
				}
				placeholder.subtasks.push(structuredTask);
			}
		}
	}

	sortStructuredTasksRecursive(rootTask, positionsById);
	return rootTask.subtasks;
}

function serializeTasks(
	structuredTasks: StructuredTask[],
	subtaskLevel: number,
): string {
	let response = "";
	let placeholderParentCount = 0;
	const placeholderParentTitle = "Unknown parent";

	for (const task of structuredTasks) {
		const indent = "  ".repeat(subtaskLevel);
		const bullet = subtaskLevel === 0 ? "-" : "*";

		let title: string;
		if (task.title !== undefined) {
			title = task.title;
		} else if (task.isPlaceholderParent) {
			title = placeholderParentTitle;
			placeholderParentCount++;
		} else {
			title = "Untitled";
		}

		response += `${indent}${bullet} ${title} (ID: ${task.id})\n`;
		response += `${indent}  Status: ${task.status ?? "N/A"}\n`;
		if (task.due) response += `${indent}  Due: ${task.due}\n`;
		if (task.notes) {
			const truncated =
				task.notes.length > 100 ? `${task.notes.slice(0, 100)}...` : task.notes;
			response += `${indent}  Notes: ${truncated}\n`;
		}
		if (task.completed) response += `${indent}  Completed: ${task.completed}\n`;
		response += `${indent}  Updated: ${task.updated ?? "N/A"}\n`;
		response += "\n";

		response += serializeTasks(task.subtasks, subtaskLevel + 1);
	}

	if (placeholderParentCount > 0) {
		response += `\n${placeholderParentCount} tasks with title ${placeholderParentTitle} are included as placeholders.\nThese placeholders contain subtasks whose parents were not present in the task list.\nThis can occur due to pagination. Callers can often avoid this problem if max_results is large enough to contain all tasks (subtasks and their parents) without paging.\nThis can also occur due to filtering that excludes parent tasks while including their subtasks or due to deleted or hidden parent tasks.\n`;
	}

	return response;
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. list_task_lists ────────────────────────────────────────────────────
	server.tool(
		"list_task_lists",
		"List all Google Task lists for the connected account.",
		{
			max_results: z
				.number()
				.int()
				.default(1000)
				.describe(
					"Maximum number of task lists to return (default: 1000, max: 1000).",
				),
			page_token: z.string().optional().describe("Token for pagination."),
		},
		async ({ max_results, page_token }) => {
			const { accessToken } = await ctx.getService("gtasks");
			const url = buildUrl(`${TASKS_BASE}/users/@me/lists`, {
				maxResults: max_results,
				pageToken: page_token,
			});
			const result = (await tasksFetch(accessToken, url)) as TaskListsResponse;
			const taskLists = result.items ?? [];
			const nextPageToken = result.nextPageToken;

			if (taskLists.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No task lists found." }],
				};
			}

			let response = "Task Lists:\n";
			for (const taskList of taskLists) {
				response += `- ${taskList.title ?? "Untitled"} (ID: ${taskList.id ?? "N/A"})\n`;
				response += `  Updated: ${taskList.updated ?? "N/A"}\n`;
			}
			if (nextPageToken) {
				response += `\nNext page token: ${nextPageToken}`;
			}

			return { content: [{ type: "text" as const, text: response }] };
		},
	);

	// ── 2. get_task_list ──────────────────────────────────────────────────────
	server.tool(
		"get_task_list",
		"Get details of a specific Google Task list.",
		{
			task_list_id: z.string().describe("The ID of the task list to retrieve."),
		},
		async ({ task_list_id }) => {
			const { accessToken } = await ctx.getService("gtasks");
			const taskList = (await tasksFetch(
				accessToken,
				`${TASKS_BASE}/users/@me/lists/${encodeURIComponent(task_list_id)}`,
			)) as TaskList;

			const text = [
				"Task List Details:",
				`- Title: ${taskList.title ?? "Untitled"}`,
				`- ID: ${taskList.id ?? "N/A"}`,
				`- Updated: ${taskList.updated ?? "N/A"}`,
				`- Self Link: ${taskList.selfLink ?? "N/A"}`,
			].join("\n");

			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 3. manage_task_list ───────────────────────────────────────────────────
	server.tool(
		"manage_task_list",
		'Manage Google Task lists: create, update, delete, or clear completed tasks. Actions: "create", "update", "delete", "clear_completed".',
		{
			action: z
				.enum(["create", "update", "delete", "clear_completed"])
				.describe(
					'Action to perform: "create", "update", "delete", or "clear_completed".',
				),
			task_list_id: z
				.string()
				.optional()
				.describe(
					"ID of the task list. Required for update, delete, and clear_completed.",
				),
			title: z
				.string()
				.optional()
				.describe("Title of the task list. Required for create and update."),
		},
		async ({ action, task_list_id, title }) => {
			const { accessToken } = await ctx.getService("gtasks");
			let text: string;

			if (action === "create") {
				if (!title)
					throw new Error("'title' is required for the 'create' action.");
				const result = (await tasksFetch(
					accessToken,
					`${TASKS_BASE}/users/@me/lists`,
					{ method: "POST", body: JSON.stringify({ title }) },
				)) as TaskList;
				text = [
					"Task List Created:",
					`- Title: ${result.title ?? title}`,
					`- ID: ${result.id ?? "N/A"}`,
					`- Created: ${result.updated ?? "N/A"}`,
					`- Self Link: ${result.selfLink ?? "N/A"}`,
				].join("\n");
			} else if (action === "update") {
				if (!task_list_id)
					throw new Error(
						"'task_list_id' is required for the 'update' action.",
					);
				if (!title)
					throw new Error("'title' is required for the 'update' action.");
				const result = (await tasksFetch(
					accessToken,
					`${TASKS_BASE}/users/@me/lists/${encodeURIComponent(task_list_id)}`,
					{
						method: "PUT",
						body: JSON.stringify({ id: task_list_id, title }),
					},
				)) as TaskList;
				text = [
					"Task List Updated:",
					`- Title: ${result.title ?? title}`,
					`- ID: ${result.id ?? task_list_id}`,
					`- Updated: ${result.updated ?? "N/A"}`,
				].join("\n");
			} else if (action === "delete") {
				if (!task_list_id)
					throw new Error(
						"'task_list_id' is required for the 'delete' action.",
					);
				await tasksFetch(
					accessToken,
					`${TASKS_BASE}/users/@me/lists/${encodeURIComponent(task_list_id)}`,
					{ method: "DELETE" },
				);
				text = `Task list ${task_list_id} has been deleted. All tasks in this list have also been deleted.`;
			} else {
				// action === "clear_completed"
				if (!task_list_id)
					throw new Error(
						"'task_list_id' is required for the 'clear_completed' action.",
					);
				await tasksFetch(
					accessToken,
					`${TASKS_BASE}/lists/${encodeURIComponent(task_list_id)}/clear`,
					{ method: "POST", body: JSON.stringify({}) },
				);
				text = `All completed tasks have been cleared from task list ${task_list_id}. The tasks are now hidden and won't appear in default task list views.`;
			}

			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 4. list_tasks ─────────────────────────────────────────────────────────
	server.tool(
		"list_tasks",
		"List all tasks in a specific Google Task list with hierarchy support and auto-pagination up to max_results.",
		{
			task_list_id: z
				.string()
				.describe("The ID of the task list to retrieve tasks from."),
			max_results: z
				.number()
				.int()
				.default(LIST_TASKS_MAX_RESULTS_DEFAULT)
				.describe(
					`Maximum number of tasks to return (default: ${LIST_TASKS_MAX_RESULTS_DEFAULT}, max: ${LIST_TASKS_MAX_RESULTS_MAX}).`,
				),
			page_token: z
				.string()
				.optional()
				.describe(
					"Starting page token for pagination (auto-pagination continues from here).",
				),
			show_completed: z
				.boolean()
				.default(true)
				.describe(
					"Whether to include completed tasks (default: true). Note: show_hidden must also be true to show tasks completed in first-party clients such as the web UI.",
				),
			show_deleted: z
				.boolean()
				.default(false)
				.describe("Whether to include deleted tasks (default: false)."),
			show_hidden: z
				.boolean()
				.default(false)
				.describe("Whether to include hidden tasks (default: false)."),
			show_assigned: z
				.boolean()
				.default(false)
				.describe("Whether to include assigned tasks (default: false)."),
			completed_max: z
				.string()
				.optional()
				.describe("Upper bound for completion date (RFC 3339 timestamp)."),
			completed_min: z
				.string()
				.optional()
				.describe("Lower bound for completion date (RFC 3339 timestamp)."),
			due_max: z
				.string()
				.optional()
				.describe(
					"Upper bound for due date (RFC 3339 timestamp). Automatically adjusted by one day to compensate for the API's exclusive bound.",
				),
			due_min: z
				.string()
				.optional()
				.describe("Lower bound for due date (RFC 3339 timestamp)."),
			updated_min: z
				.string()
				.optional()
				.describe(
					"Lower bound for last modification time (RFC 3339 timestamp).",
				),
		},
		async ({
			task_list_id,
			max_results,
			page_token,
			show_completed,
			show_deleted,
			show_hidden,
			show_assigned,
			completed_max,
			completed_min,
			due_max,
			due_min,
			updated_min,
		}) => {
			const { accessToken } = await ctx.getService("gtasks");

			const effectiveDueMax = due_max
				? adjustDueMaxForTasksApi(due_max)
				: undefined;

			const baseParams: Record<
				string,
				string | number | boolean | null | undefined
			> = {
				maxResults: max_results,
				pageToken: page_token,
				showCompleted: show_completed,
				showDeleted: show_deleted,
				showHidden: show_hidden,
				showAssigned: show_assigned,
				completedMax: completed_max,
				completedMin: completed_min,
				dueMax: effectiveDueMax,
				dueMin: due_min,
				updatedMin: updated_min,
			};

			const baseUrl = `${TASKS_BASE}/lists/${encodeURIComponent(task_list_id)}/tasks`;
			const firstResult = (await tasksFetch(
				accessToken,
				buildUrl(baseUrl, baseParams),
			)) as TasksResponse;

			let tasks: Task[] = firstResult.items ?? [];
			let nextPageToken: string | undefined = firstResult.nextPageToken;

			// Auto-paginate up to effectiveMax, matching Python's behaviour of fetching
			// remaining pages automatically so the caller gets a fully sorted hierarchy.
			const effectiveMax = Math.min(max_results, LIST_TASKS_MAX_RESULTS_MAX);
			let remaining = effectiveMax - tasks.length;

			while (remaining > 0 && nextPageToken) {
				const pageResult = (await tasksFetch(
					accessToken,
					buildUrl(baseUrl, {
						...baseParams,
						pageToken: nextPageToken,
						maxResults: remaining,
					}),
				)) as TasksResponse;
				const moreTasks = pageResult.items ?? [];
				nextPageToken = pageResult.nextPageToken;
				if (moreTasks.length === 0) break;
				tasks = [...tasks, ...moreTasks];
				remaining -= moreTasks.length;
			}

			if (tasks.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No tasks found in task list ${task_list_id}.`,
						},
					],
				};
			}

			const structuredTasks = getStructuredTasks(tasks);
			let response = `Tasks in list ${task_list_id}:\n`;
			response += serializeTasks(structuredTasks, 0);
			if (nextPageToken) {
				response += `Next page token: ${nextPageToken}\n`;
			}

			return { content: [{ type: "text" as const, text: response }] };
		},
	);

	// ── 5. get_task ───────────────────────────────────────────────────────────
	server.tool(
		"get_task",
		"Get details of a specific task in a Google Task list.",
		{
			task_list_id: z
				.string()
				.describe("The ID of the task list containing the task."),
			task_id: z.string().describe("The ID of the task to retrieve."),
		},
		async ({ task_list_id, task_id }) => {
			const { accessToken } = await ctx.getService("gtasks");
			const task = (await tasksFetch(
				accessToken,
				`${TASKS_BASE}/lists/${encodeURIComponent(task_list_id)}/tasks/${encodeURIComponent(task_id)}`,
			)) as Task;

			const parts = [
				"Task Details:",
				`- Title: ${task.title ?? "Untitled"}`,
				`- ID: ${task.id ?? "N/A"}`,
				`- Status: ${task.status ?? "N/A"}`,
				`- Updated: ${task.updated ?? "N/A"}`,
			];
			if (task.due) parts.push(`- Due Date: ${task.due}`);
			if (task.completed) parts.push(`- Completed: ${task.completed}`);
			if (task.notes) parts.push(`- Notes: ${task.notes}`);
			if (task.parent) parts.push(`- Parent Task ID: ${task.parent}`);
			if (task.position) parts.push(`- Position: ${task.position}`);
			if (task.selfLink) parts.push(`- Self Link: ${task.selfLink}`);
			if (task.webViewLink) parts.push(`- Web View Link: ${task.webViewLink}`);

			return {
				content: [{ type: "text" as const, text: parts.join("\n") }],
			};
		},
	);

	// ── 6. manage_task ────────────────────────────────────────────────────────
	server.tool(
		"manage_task",
		'Manage Google Tasks: create, update, delete, or move tasks within task lists. Actions: "create", "update", "delete", "move".',
		{
			action: z
				.enum(["create", "update", "delete", "move"])
				.describe(
					'Action to perform: "create", "update", "delete", or "move".',
				),
			task_list_id: z
				.string()
				.describe("The ID of the task list. Required for all actions."),
			task_id: z
				.string()
				.optional()
				.describe(
					"The ID of the task. Required for update, delete, and move actions.",
				),
			title: z
				.string()
				.optional()
				.describe(
					"The title of the task. Required for create, optional for update.",
				),
			notes: z
				.string()
				.optional()
				.describe("Notes/description for the task. Used by create and update."),
			status: z
				.enum(["needsAction", "completed"])
				.optional()
				.describe(
					'Task status: "needsAction" or "completed". Used by the update action only.',
				),
			due: z
				.string()
				.optional()
				.describe(
					"Due date in RFC 3339 format (e.g., '2024-12-31T23:59:59Z'). Used by create and update.",
				),
			parent: z
				.string()
				.optional()
				.describe(
					"Parent task ID (creates a subtask). Used by create and move actions.",
				),
			previous: z
				.string()
				.optional()
				.describe(
					"Previous sibling task ID for ordering. Used by create and move actions.",
				),
			destination_task_list: z
				.string()
				.optional()
				.describe(
					"Destination task list ID for moving a task between lists. Used by the move action.",
				),
		},
		async ({
			action,
			task_list_id,
			task_id,
			title,
			notes,
			status,
			due,
			parent,
			previous,
			destination_task_list,
		}) => {
			const { accessToken } = await ctx.getService("gtasks");

			if (due !== undefined) validateRfc3339Date(due);

			const listBase = `${TASKS_BASE}/lists/${encodeURIComponent(task_list_id)}/tasks`;
			let text: string;

			if (action === "create") {
				if (status !== undefined)
					throw new Error(
						"'status' is only supported for the 'update' action.",
					);
				if (!title)
					throw new Error("'title' is required for the 'create' action.");

				const body: Record<string, string> = { title };
				if (notes) body.notes = notes;
				if (due) body.due = due;

				const result = (await tasksFetch(
					accessToken,
					buildUrl(listBase, { parent, previous }),
					{ method: "POST", body: JSON.stringify(body) },
				)) as Task;

				const parts = [
					"Task Created:",
					`- Title: ${result.title ?? title}`,
					`- ID: ${result.id ?? "N/A"}`,
					`- Status: ${result.status ?? "N/A"}`,
					`- Updated: ${result.updated ?? "N/A"}`,
				];
				if (result.due) parts.push(`- Due Date: ${result.due}`);
				if (result.notes) parts.push(`- Notes: ${result.notes}`);
				if (result.webViewLink)
					parts.push(`- Web View Link: ${result.webViewLink}`);
				text = parts.join("\n");
			} else if (action === "update") {
				if (!task_id)
					throw new Error("'task_id' is required for the 'update' action.");

				// Read-modify-write: fetch current task to preserve unspecified fields.
				const current = (await tasksFetch(
					accessToken,
					`${listBase}/${encodeURIComponent(task_id)}`,
				)) as Task;

				const body: Record<string, string> = {
					id: task_id,
					title: title ?? current.title ?? "",
					status: status ?? current.status ?? "needsAction",
				};
				if (notes !== undefined) {
					body.notes = notes;
				} else if (current.notes) {
					body.notes = current.notes;
				}
				if (due !== undefined) {
					body.due = due;
				} else if (current.due) {
					body.due = current.due;
				}

				const result = (await tasksFetch(
					accessToken,
					`${listBase}/${encodeURIComponent(task_id)}`,
					{ method: "PUT", body: JSON.stringify(body) },
				)) as Task;

				const parts = [
					"Task Updated:",
					`- Title: ${result.title ?? title ?? "N/A"}`,
					`- ID: ${result.id ?? task_id}`,
					`- Status: ${result.status ?? "N/A"}`,
					`- Updated: ${result.updated ?? "N/A"}`,
				];
				if (result.due) parts.push(`- Due Date: ${result.due}`);
				if (result.notes) parts.push(`- Notes: ${result.notes}`);
				if (result.completed) parts.push(`- Completed: ${result.completed}`);
				text = parts.join("\n");
			} else if (action === "delete") {
				if (!task_id)
					throw new Error("'task_id' is required for the 'delete' action.");
				await tasksFetch(
					accessToken,
					`${listBase}/${encodeURIComponent(task_id)}`,
					{ method: "DELETE" },
				);
				text = `Task ${task_id} has been deleted from task list ${task_list_id}.`;
			} else {
				// action === "move"
				if (!task_id)
					throw new Error("'task_id' is required for the 'move' action.");

				const result = (await tasksFetch(
					accessToken,
					buildUrl(`${listBase}/${encodeURIComponent(task_id)}/move`, {
						parent,
						previous,
						destinationTasklist: destination_task_list,
					}),
					{ method: "POST", body: JSON.stringify({}) },
				)) as Task;

				const parts = [
					"Task Moved:",
					`- Title: ${result.title ?? "N/A"}`,
					`- ID: ${result.id ?? task_id}`,
					`- Status: ${result.status ?? "N/A"}`,
					`- Updated: ${result.updated ?? "N/A"}`,
				];
				if (result.parent) parts.push(`- Parent Task ID: ${result.parent}`);
				if (result.position) parts.push(`- Position: ${result.position}`);

				const moveDetails: string[] = [];
				if (destination_task_list)
					moveDetails.push(`moved to task list ${destination_task_list}`);
				if (parent) moveDetails.push(`made a subtask of ${parent}`);
				if (previous) moveDetails.push(`positioned after ${previous}`);
				if (moveDetails.length > 0)
					parts.push(`- Move Details: ${moveDetails.join(", ")}`);

				text = parts.join("\n");
			}

			return { content: [{ type: "text" as const, text }] };
		},
	);
}
