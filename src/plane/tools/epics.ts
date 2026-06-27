import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext, PlaneConfig } from "../client";
import { epics } from "../resources/epics";
import { workItemTypes } from "../resources/work_item_types";
import type { PriorityEnum } from "../types/common";
import type { WorkItemType } from "../types/work_item_types";
import {
	projectIdField,
	requireProjectId,
	toolResult,
	toolResultWithUrl,
} from "./_helpers";

const PRIORITIES: readonly PriorityEnum[] = [
	"urgent",
	"high",
	"medium",
	"low",
	"none",
];

function validatePriorityOptional(
	value: string | undefined,
): PriorityEnum | undefined {
	if (value && (PRIORITIES as readonly string[]).includes(value)) {
		return value as PriorityEnum;
	}
	return undefined;
}

function validatePriorityStrict(
	value: string | undefined,
): PriorityEnum | undefined {
	if (value === undefined) return undefined;
	if (!(PRIORITIES as readonly string[]).includes(value)) {
		throw new Error(
			`Invalid priority '${value}'. Must be one of: ${PRIORITIES.join(", ")}`,
		);
	}
	return value as PriorityEnum;
}

async function getEpicWorkItemType(
	config: PlaneConfig,
	workspaceSlug: string,
	projectId: string,
): Promise<WorkItemType | null> {
	const list = await workItemTypes.list(config, workspaceSlug, projectId);
	for (const t of list) {
		if (t.is_epic) return t;
	}
	return null;
}

export function registerEpicTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_epics",
		"List all epics in a project.",
		{
			...projectIdField(ctx),
			cursor: z
				.string()
				.optional()
				.describe("Pagination cursor for getting next set of results"),
			per_page: z
				.number()
				.int()
				.optional()
				.describe("Number of results per page (1-100)"),
		},
		async (input) =>
			toolResultWithUrl("epic", ctx, async () => {
				const response = await epics.list(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					{ cursor: input.cursor, per_page: input.per_page },
				);
				return response.results;
			}),
	);

	server.tool(
		"create_epic",
		"Create a new epic.",
		{
			...projectIdField(ctx),
			name: z.string().describe("Epic name (required)"),
			assignees: z
				.array(z.string())
				.optional()
				.describe("List of user IDs to assign to the epic"),
			labels: z
				.array(z.string())
				.optional()
				.describe("List of label IDs to attach to the epic"),
			point: z.number().int().optional().describe("Story point value"),
			description_html: z
				.string()
				.optional()
				.describe("HTML description of the epic"),
			description_stripped: z
				.string()
				.optional()
				.describe("Plain text description (stripped of HTML)"),
			priority: z
				.string()
				.optional()
				.describe("Priority level (urgent, high, medium, low, none)"),
			start_date: z
				.string()
				.optional()
				.describe("Start date (ISO 8601 format)"),
			target_date: z
				.string()
				.optional()
				.describe("Target/end date (ISO 8601 format)"),
			sort_order: z.number().optional().describe("Sort order value"),
			is_draft: z.boolean().optional().describe("Whether the epic is a draft"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
			parent: z.string().optional().describe("UUID of the parent epic"),
			state: z.string().optional().describe("UUID of the state"),
			estimate_point: z.string().optional().describe("Estimate point value"),
		},
		async (input) =>
			toolResultWithUrl("epic", ctx, async () => {
				const projectId = requireProjectId(ctx, input);
				const epicType = await getEpicWorkItemType(
					ctx.config,
					ctx.workspaceSlug,
					projectId,
				);
				if (epicType === null) {
					throw new Error(
						"No work item type with is_epic=True found in the project",
					);
				}
				const workItem = await epics.createWorkItem(
					ctx.config,
					ctx.workspaceSlug,
					projectId,
					{
						name: input.name,
						assignees: input.assignees,
						labels: input.labels,
						type_id: epicType.id ?? undefined,
						point: input.point,
						description_html: input.description_html,
						description_stripped: input.description_stripped,
						priority: validatePriorityOptional(input.priority),
						start_date: input.start_date,
						target_date: input.target_date,
						sort_order: input.sort_order,
						is_draft: input.is_draft,
						external_source: input.external_source,
						external_id: input.external_id,
						parent: input.parent,
						state: input.state,
						estimate_point: input.estimate_point,
					},
				);
				return epics.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					projectId,
					workItem.id ?? "",
				);
			}),
	);

	server.tool(
		"update_epic",
		"Update an epic by ID.",
		{
			...projectIdField(ctx),
			epic_id: z.string().describe("UUID of the epic"),
			name: z.string().optional().describe("Epic name"),
			assignees: z
				.array(z.string())
				.optional()
				.describe("List of user IDs to assign to the epic"),
			labels: z
				.array(z.string())
				.optional()
				.describe("List of label IDs to attach to the epic"),
			point: z.number().int().optional().describe("Story point value"),
			description_html: z
				.string()
				.optional()
				.describe("HTML description of the epic"),
			description_stripped: z
				.string()
				.optional()
				.describe("Plain text description (stripped of HTML)"),
			priority: z
				.string()
				.optional()
				.describe("Priority level (urgent, high, medium, low, none)"),
			start_date: z
				.string()
				.optional()
				.describe("Start date (ISO 8601 format)"),
			target_date: z
				.string()
				.optional()
				.describe("Target/end date (ISO 8601 format)"),
			sort_order: z.number().optional().describe("Sort order value"),
			is_draft: z.boolean().optional().describe("Whether the epic is a draft"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
			state: z.string().optional().describe("UUID of the state"),
			estimate_point: z.string().optional().describe("Estimate point value"),
		},
		async (input) =>
			toolResult(async () => {
				const projectId = requireProjectId(ctx, input);
				const validatedPriority = validatePriorityStrict(input.priority);
				const workItem = await epics.updateWorkItem(
					ctx.config,
					ctx.workspaceSlug,
					projectId,
					input.epic_id,
					{
						name: input.name,
						assignees: input.assignees,
						labels: input.labels,
						point: input.point,
						description_html: input.description_html,
						description_stripped: input.description_stripped,
						priority: validatedPriority,
						start_date: input.start_date,
						target_date: input.target_date,
						sort_order: input.sort_order,
						is_draft: input.is_draft,
						external_source: input.external_source,
						external_id: input.external_id,
						state: input.state,
						estimate_point: input.estimate_point,
					},
				);
				return epics.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					projectId,
					workItem.id ?? "",
				);
			}),
	);

	server.tool(
		"retrieve_epic",
		"Retrieve an epic by ID.",
		{
			...projectIdField(ctx),
			epic_id: z.string().describe("UUID of the epic"),
		},
		async (input) =>
			toolResultWithUrl("epic", ctx, () =>
				epics.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.epic_id,
					{},
				),
			),
	);

	server.tool(
		"delete_epic",
		"Delete an epic by ID.",
		{
			...projectIdField(ctx),
			epic_id: z.string().describe("UUID of the epic"),
		},
		async (input) =>
			toolResult(() =>
				epics.deleteWorkItem(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.epic_id,
				),
			),
	);
}
