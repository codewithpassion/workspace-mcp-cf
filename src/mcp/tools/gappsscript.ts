// Google Apps Script tools — 15 tools for the `gappsscript` service.
//
// Notes:
//  - list_script_projects / delete_script_project use Drive API v3 (GoogleService "gdrive")
//    because the Apps Script API has no projects.list or project-delete methods.
//  - All other API-calling tools use Apps Script API v1 (GoogleService "gappsscript").
//  - generate_trigger_code makes NO API call — pure local code generation.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── API base URLs ─────────────────────────────────────────────────────────────

const SCRIPT_BASE = "https://script.googleapis.com/v1";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

// ─── URL builder (omits null/undefined params) ────────────────────────────────

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

interface DriveFile {
	id?: string;
	name?: string;
	createdTime?: string;
	modifiedTime?: string;
}

interface DriveFilesListResponse {
	files?: DriveFile[];
	nextPageToken?: string;
}

interface ScriptUser {
	email?: string;
}

interface ScriptProject {
	scriptId?: string;
	title?: string;
	creator?: ScriptUser;
	createTime?: string;
	updateTime?: string;
}

interface ScriptFile {
	name?: string;
	type?: string;
	source?: string;
}

interface ScriptContent {
	files?: ScriptFile[];
}

interface Deployment {
	deploymentId?: string;
	description?: string;
	updateTime?: string;
}

interface DeploymentsListResponse {
	deployments?: Deployment[];
}

interface DeploymentVersion {
	versionNumber?: number;
	createTime?: string;
}

interface Version {
	versionNumber?: number;
	description?: string;
	createTime?: string;
}

interface VersionsListResponse {
	versions?: Version[];
}

interface ScriptProcess {
	functionName?: string;
	processStatus?: string;
	startTime?: string;
	duration?: string;
}

interface ProcessesListResponse {
	processes?: ScriptProcess[];
}

interface MetricValue {
	startTime?: string;
	endTime?: string;
	value?: string;
}

interface ScriptMetrics {
	activeUsers?: MetricValue[];
	totalExecutions?: MetricValue[];
	failedExecutions?: MetricValue[];
}

interface RunScriptError {
	message?: string;
}

interface RunScriptResponse {
	error?: RunScriptError;
	response?: { result?: unknown };
}

// ─── Trigger code generation (no API call) ────────────────────────────────────

function generateTriggerCodeImpl(
	triggerType: string,
	functionName: string,
	schedule: string,
): string {
	let codeLines: string[] = [];

	if (triggerType === "on_open") {
		codeLines = [
			"// Simple trigger - just rename your function to 'onOpen'",
			"// This runs automatically when the document is opened",
			"function onOpen(e) {",
			`  ${functionName}();`,
			"}",
		];
	} else if (triggerType === "on_edit") {
		codeLines = [
			"// Simple trigger - just rename your function to 'onEdit'",
			"// This runs automatically when a user edits the spreadsheet",
			"function onEdit(e) {",
			`  ${functionName}();`,
			"}",
		];
	} else if (triggerType === "time_minutes") {
		const interval = schedule || "5";
		codeLines = [
			"// Run this function ONCE to install the trigger",
			`function createTimeTrigger_${functionName}() {`,
			"  // Delete existing triggers for this function first",
			"  const triggers = ScriptApp.getProjectTriggers();",
			"  triggers.forEach(trigger => {",
			`    if (trigger.getHandlerFunction() === '${functionName}') {`,
			"      ScriptApp.deleteTrigger(trigger);",
			"    }",
			"  });",
			"",
			`  // Create new trigger - runs every ${interval} minutes`,
			`  ScriptApp.newTrigger('${functionName}')`,
			"    .timeBased()",
			`    .everyMinutes(${interval})`,
			"    .create();",
			"",
			`  Logger.log('Trigger created: ${functionName} will run every ${interval} minutes');`,
			"}",
		];
	} else if (triggerType === "time_hours") {
		const interval = schedule || "1";
		codeLines = [
			"// Run this function ONCE to install the trigger",
			`function createTimeTrigger_${functionName}() {`,
			"  // Delete existing triggers for this function first",
			"  const triggers = ScriptApp.getProjectTriggers();",
			"  triggers.forEach(trigger => {",
			`    if (trigger.getHandlerFunction() === '${functionName}') {`,
			"      ScriptApp.deleteTrigger(trigger);",
			"    }",
			"  });",
			"",
			`  // Create new trigger - runs every ${interval} hour(s)`,
			`  ScriptApp.newTrigger('${functionName}')`,
			"    .timeBased()",
			`    .everyHours(${interval})`,
			"    .create();",
			"",
			`  Logger.log('Trigger created: ${functionName} will run every ${interval} hour(s)');`,
			"}",
		];
	} else if (triggerType === "time_daily") {
		const hour = schedule || "9";
		codeLines = [
			"// Run this function ONCE to install the trigger",
			`function createDailyTrigger_${functionName}() {`,
			"  // Delete existing triggers for this function first",
			"  const triggers = ScriptApp.getProjectTriggers();",
			"  triggers.forEach(trigger => {",
			`    if (trigger.getHandlerFunction() === '${functionName}') {`,
			"      ScriptApp.deleteTrigger(trigger);",
			"    }",
			"  });",
			"",
			`  // Create new trigger - runs daily at ${hour}:00`,
			`  ScriptApp.newTrigger('${functionName}')`,
			"    .timeBased()",
			`    .atHour(${hour})`,
			"    .everyDays(1)",
			"    .create();",
			"",
			`  Logger.log('Trigger created: ${functionName} will run daily at ${hour}:00');`,
			"}",
		];
	} else if (triggerType === "time_weekly") {
		const day = schedule ? schedule.toUpperCase() : "MONDAY";
		codeLines = [
			"// Run this function ONCE to install the trigger",
			`function createWeeklyTrigger_${functionName}() {`,
			"  // Delete existing triggers for this function first",
			"  const triggers = ScriptApp.getProjectTriggers();",
			"  triggers.forEach(trigger => {",
			`    if (trigger.getHandlerFunction() === '${functionName}') {`,
			"      ScriptApp.deleteTrigger(trigger);",
			"    }",
			"  });",
			"",
			`  // Create new trigger - runs weekly on ${day}`,
			`  ScriptApp.newTrigger('${functionName}')`,
			"    .timeBased()",
			`    .onWeekDay(ScriptApp.WeekDay.${day})`,
			"    .atHour(9)",
			"    .create();",
			"",
			`  Logger.log('Trigger created: ${functionName} will run every ${day} at 9:00');`,
			"}",
		];
	} else if (triggerType === "on_form_submit") {
		codeLines = [
			"// Run this function ONCE to install the trigger",
			"// This must be run from a script BOUND to the Google Form",
			`function createFormSubmitTrigger_${functionName}() {`,
			"  // Delete existing triggers for this function first",
			"  const triggers = ScriptApp.getProjectTriggers();",
			"  triggers.forEach(trigger => {",
			`    if (trigger.getHandlerFunction() === '${functionName}') {`,
			"      ScriptApp.deleteTrigger(trigger);",
			"    }",
			"  });",
			"",
			"  // Create new trigger - runs when form is submitted",
			`  ScriptApp.newTrigger('${functionName}')`,
			"    .forForm(FormApp.getActiveForm())",
			"    .onFormSubmit()",
			"    .create();",
			"",
			`  Logger.log('Trigger created: ${functionName} will run on form submit');`,
			"}",
		];
	} else if (triggerType === "on_change") {
		codeLines = [
			"// Run this function ONCE to install the trigger",
			"// This must be run from a script BOUND to a Google Sheet",
			`function createChangeTrigger_${functionName}() {`,
			"  // Delete existing triggers for this function first",
			"  const triggers = ScriptApp.getProjectTriggers();",
			"  triggers.forEach(trigger => {",
			`    if (trigger.getHandlerFunction() === '${functionName}') {`,
			"      ScriptApp.deleteTrigger(trigger);",
			"    }",
			"  });",
			"",
			"  // Create new trigger - runs when spreadsheet changes",
			`  ScriptApp.newTrigger('${functionName}')`,
			"    .forSpreadsheet(SpreadsheetApp.getActive())",
			"    .onChange()",
			"    .create();",
			"",
			`  Logger.log('Trigger created: ${functionName} will run on spreadsheet change');`,
			"}",
		];
	} else {
		return (
			`Unknown trigger type: ${triggerType}\n\n` +
			"Valid types: time_minutes, time_hours, time_daily, time_weekly, " +
			"on_open, on_edit, on_form_submit, on_change"
		);
	}

	const code = codeLines.join("\n");

	let instructions: string[];
	if (triggerType.startsWith("on_")) {
		if (triggerType === "on_open" || triggerType === "on_edit") {
			instructions = [
				"SIMPLE TRIGGER",
				"=".repeat(50),
				"",
				"Add this code to your script. Simple triggers run automatically",
				"when the event occurs - no setup function needed.",
				"",
				"Note: Simple triggers have limitations:",
				"- Cannot access services that require authorization",
				"- Cannot run longer than 30 seconds",
				"- Cannot make external HTTP requests",
				"",
				"For more capabilities, use an installable trigger instead.",
				"",
				"CODE TO ADD:",
				"-".repeat(50),
			];
		} else {
			instructions = [
				"INSTALLABLE TRIGGER",
				"=".repeat(50),
				"",
				"1. Add this code to your script",
				`2. Run the setup function once: createFormSubmitTrigger_${functionName}() or similar`,
				"3. The trigger will then run automatically",
				"",
				"CODE TO ADD:",
				"-".repeat(50),
			];
		}
	} else {
		instructions = [
			"INSTALLABLE TRIGGER",
			"=".repeat(50),
			"",
			"1. Add this code to your script using update_script_content",
			"2. Run the setup function ONCE (manually in Apps Script editor or via run_script_function)",
			"3. The trigger will then run automatically on schedule",
			"",
			"To check installed triggers: Apps Script editor > Triggers (clock icon)",
			"",
			"CODE TO ADD:",
			"-".repeat(50),
		];
	}

	return `${instructions.join("\n")}\n\n${code}`;
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. list_script_projects (Drive API) ──────────────────────────────────
	server.tool(
		"list_script_projects",
		"Lists Google Apps Script projects accessible to the user. Uses Drive API to find Apps Script files since the Script API has no projects.list method.",
		{
			page_size: z
				.number()
				.int()
				.default(50)
				.describe("Number of results per page (default: 50)."),
			page_token: z.string().optional().describe("Token for pagination."),
		},
		async ({ page_size, page_token }) => {
			const { accessToken } = await ctx.getService("gdrive");
			const url = buildUrl(`${DRIVE_BASE}/files`, {
				q: "mimeType='application/vnd.google-apps.script' and trashed=false",
				pageSize: page_size,
				fields: "nextPageToken, files(id, name, createdTime, modifiedTime)",
				orderBy: "modifiedTime desc",
				pageToken: page_token,
			});
			const data = (await googleApiFetch(
				accessToken,
				url,
			)) as DriveFilesListResponse;
			const files = data.files ?? [];
			if (files.length === 0) {
				return {
					content: [
						{ type: "text" as const, text: "No Apps Script projects found." },
					],
				};
			}
			const lines = [`Found ${files.length} Apps Script projects:`];
			for (const file of files) {
				lines.push(
					`- ${file.name ?? "Untitled"} (ID: ${file.id ?? "Unknown ID"}) Created: ${file.createdTime ?? "Unknown"} Modified: ${file.modifiedTime ?? "Unknown"}`,
				);
			}
			if (data.nextPageToken) {
				lines.push(`\nNext page token: ${data.nextPageToken}`);
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 2. get_script_project (Script API) ───────────────────────────────────
	server.tool(
		"get_script_project",
		"Retrieves complete project details including all source files. Fetches project metadata and content concurrently.",
		{
			script_id: z.string().describe("The script project ID."),
		},
		async ({ script_id }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const [projectRaw, contentRaw] = await Promise.all([
				googleApiFetch(
					accessToken,
					`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}`,
				),
				googleApiFetch(
					accessToken,
					`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/content`,
				),
			]);
			const project = projectRaw as ScriptProject;
			const content = contentRaw as ScriptContent;

			const lines = [
				`Project: ${project.title ?? "Untitled"} (ID: ${project.scriptId ?? "Unknown"})`,
				`Creator: ${project.creator?.email ?? "Unknown"}`,
				`Created: ${project.createTime ?? "Unknown"}`,
				`Modified: ${project.updateTime ?? "Unknown"}`,
				"",
				"Files:",
			];
			const files = content.files ?? [];
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const source = file.source ?? "";
				lines.push(
					`${i + 1}. ${file.name ?? "Untitled"} (${file.type ?? "Unknown"})`,
				);
				if (source) {
					lines.push(
						`   ${source.slice(0, 200)}${source.length > 200 ? "..." : ""}`,
					);
					lines.push("");
				}
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 3. get_script_content (Script API) ───────────────────────────────────
	server.tool(
		"get_script_content",
		"Retrieves the full source of a specific file within an Apps Script project.",
		{
			script_id: z.string().describe("The script project ID."),
			file_name: z.string().describe("Name of the file to retrieve."),
		},
		async ({ script_id, file_name }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const contentRaw = await googleApiFetch(
				accessToken,
				`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/content`,
			);
			const content = contentRaw as ScriptContent;
			const files = content.files ?? [];
			const target = files.find((f) => f.name === file_name);
			if (!target) {
				return {
					content: [
						{
							type: "text" as const,
							text: `File '${file_name}' not found in project ${script_id}`,
						},
					],
				};
			}
			const text = [
				`File: ${file_name} (${target.type ?? "Unknown"})`,
				"",
				target.source ?? "",
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 4. create_script_project (Script API) ────────────────────────────────
	server.tool(
		"create_script_project",
		"Creates a new Apps Script project. Optionally bound to a Drive container via parent_id.",
		{
			title: z.string().describe("Project title."),
			parent_id: z
				.string()
				.optional()
				.describe("Optional Drive folder ID or bound container ID."),
		},
		async ({ title, parent_id }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const body: Record<string, string> = { title };
			if (parent_id) body.parentId = parent_id;
			const projectRaw = await googleApiFetch(
				accessToken,
				`${SCRIPT_BASE}/projects`,
				{ method: "POST", body: JSON.stringify(body) },
			);
			const project = projectRaw as ScriptProject;
			const scriptId = project.scriptId ?? "Unknown";
			const text = [
				`Created Apps Script project: ${title}`,
				`Script ID: ${scriptId}`,
				`Edit URL: https://script.google.com/d/${scriptId}/edit`,
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 5. update_script_content (Script API) ────────────────────────────────
	server.tool(
		"update_script_content",
		"Updates or creates files in an Apps Script project. WARNING: Destructive — replaces ALL project files with the provided list.",
		{
			script_id: z.string().describe("The script project ID."),
			files: z
				.array(
					z.object({
						name: z.string().describe("File name (without extension)."),
						type: z
							.string()
							.describe('File type: "SERVER_JS", "HTML", or "JSON".'),
						source: z.string().describe("File source code."),
					}),
				)
				.describe("List of file objects. Replaces all existing project files."),
		},
		async ({ script_id, files }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const updatedRaw = await googleApiFetch(
				accessToken,
				`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/content`,
				{ method: "PUT", body: JSON.stringify({ files }) },
			);
			const updated = updatedRaw as ScriptContent;
			const lines = [
				`Updated script project: ${script_id}`,
				"",
				"Modified files:",
			];
			for (const file of updated.files ?? []) {
				lines.push(`- ${file.name ?? "Untitled"} (${file.type ?? "Unknown"})`);
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 6. run_script_function (Script API) ──────────────────────────────────
	server.tool(
		"run_script_function",
		"Executes a function in a deployed Apps Script project. Requires the script to be deployed as API executable.",
		{
			script_id: z.string().describe("The script project ID."),
			function_name: z.string().describe("Name of the function to execute."),
			parameters: z
				.array(z.unknown())
				.optional()
				.describe("Optional list of parameters to pass to the function."),
			dev_mode: z
				.boolean()
				.default(false)
				.describe(
					"true = run latest code; false = run deployed version (default).",
				),
		},
		async ({ script_id, function_name, parameters, dev_mode }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const body: Record<string, unknown> = {
				function: function_name,
				devMode: dev_mode,
			};
			if (parameters && parameters.length > 0) body.parameters = parameters;
			try {
				const responseRaw = await googleApiFetch(
					accessToken,
					`${SCRIPT_BASE}/scripts/${encodeURIComponent(script_id)}:run`,
					{ method: "POST", body: JSON.stringify(body) },
				);
				const response = responseRaw as RunScriptResponse;
				if (response.error) {
					const text = `Execution failed\nFunction: ${function_name}\nError: ${response.error.message ?? "Unknown error"}`;
					return { content: [{ type: "text" as const, text }] };
				}
				const result = response.response?.result ?? null;
				const text = [
					"Execution successful",
					`Function: ${function_name}`,
					`Result: ${JSON.stringify(result)}`,
				].join("\n");
				return { content: [{ type: "text" as const, text }] };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text" as const,
							text: `Execution failed\nFunction: ${function_name}\nError: ${msg}`,
						},
					],
				};
			}
		},
	);

	// ── 7. manage_deployment (Script API) ────────────────────────────────────
	server.tool(
		"manage_deployment",
		"Create, update, or delete an Apps Script deployment. Create auto-creates a version first, then deploys it.",
		{
			action: z
				.enum(["create", "update", "delete"])
				.describe('"create", "update", or "delete".'),
			script_id: z.string().describe("The script project ID."),
			deployment_id: z
				.string()
				.optional()
				.describe("Deployment ID (required for update and delete)."),
			description: z
				.string()
				.optional()
				.describe("Deployment description (required for create and update)."),
			version_description: z
				.string()
				.optional()
				.describe(
					"Version description (create only; defaults to description).",
				),
		},
		async ({
			action,
			script_id,
			deployment_id,
			description,
			version_description,
		}) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const deploymentsBase = `${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/deployments`;

			if (action === "create") {
				if (!description?.trim())
					throw new Error("description is required for create action");
				// Step 1: create an immutable version
				const versionBody = { description: version_description ?? description };
				const versionRaw = await googleApiFetch(
					accessToken,
					`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/versions`,
					{ method: "POST", body: JSON.stringify(versionBody) },
				);
				const version = versionRaw as DeploymentVersion;
				const versionNumber = version.versionNumber;
				// Step 2: create deployment pinned to that version
				const deployRaw = await googleApiFetch(accessToken, deploymentsBase, {
					method: "POST",
					body: JSON.stringify({ versionNumber, description }),
				});
				const deployment = deployRaw as Deployment;
				const text = [
					`Created deployment for script: ${script_id}`,
					`Deployment ID: ${deployment.deploymentId ?? "Unknown"}`,
					`Version: ${versionNumber ?? "Unknown"}`,
					`Description: ${description}`,
				].join("\n");
				return { content: [{ type: "text" as const, text }] };
			}

			if (action === "update") {
				if (!deployment_id)
					throw new Error("deployment_id is required for update action");
				if (!description?.trim())
					throw new Error("description is required for update action");
				const updateBody: Record<string, string> = {};
				if (description) updateBody.description = description;
				const deployRaw = await googleApiFetch(
					accessToken,
					`${deploymentsBase}/${encodeURIComponent(deployment_id)}`,
					{ method: "PUT", body: JSON.stringify(updateBody) },
				);
				const deployment = deployRaw as Deployment;
				const text = [
					`Updated deployment: ${deployment_id}`,
					`Script: ${script_id}`,
					`Description: ${deployment.description ?? "No description"}`,
				].join("\n");
				return { content: [{ type: "text" as const, text }] };
			}

			// action === "delete"
			if (!deployment_id)
				throw new Error("deployment_id is required for delete action");
			await googleApiFetch(
				accessToken,
				`${deploymentsBase}/${encodeURIComponent(deployment_id)}`,
				{ method: "DELETE" },
			);
			return {
				content: [
					{
						type: "text" as const,
						text: `Deleted deployment: ${deployment_id} from script: ${script_id}`,
					},
				],
			};
		},
	);

	// ── 8. list_deployments (Script API) ─────────────────────────────────────
	server.tool(
		"list_deployments",
		"Lists all deployments for an Apps Script project.",
		{
			script_id: z.string().describe("The script project ID."),
		},
		async ({ script_id }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const dataRaw = await googleApiFetch(
				accessToken,
				`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/deployments`,
			);
			const data = dataRaw as DeploymentsListResponse;
			const deployments = data.deployments ?? [];
			if (deployments.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No deployments found for script: ${script_id}`,
						},
					],
				};
			}
			const lines = [`Deployments for script: ${script_id}`, ""];
			for (let i = 0; i < deployments.length; i++) {
				const d = deployments[i];
				lines.push(
					`${i + 1}. ${d.description ?? "No description"} (${d.deploymentId ?? "Unknown"})`,
				);
				lines.push(`   Updated: ${d.updateTime ?? "Unknown"}`);
				lines.push("");
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 9. list_script_processes (Script API) ────────────────────────────────
	server.tool(
		"list_script_processes",
		"Lists recent execution processes for the user's Apps Script projects.",
		{
			page_size: z
				.number()
				.int()
				.default(50)
				.describe("Number of results (default: 50)."),
			script_id: z
				.string()
				.optional()
				.describe("Optional: filter results to a specific script ID."),
		},
		async ({ page_size, script_id }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const params: Record<
				string,
				string | number | boolean | null | undefined
			> = { pageSize: page_size };
			if (script_id) params["userProcessFilter.scriptId"] = script_id;
			const url = buildUrl(`${SCRIPT_BASE}/processes`, params);
			const dataRaw = await googleApiFetch(accessToken, url);
			const data = dataRaw as ProcessesListResponse;
			const processes = data.processes ?? [];
			if (processes.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No recent script executions found.",
						},
					],
				};
			}
			const lines = ["Recent script executions:", ""];
			for (let i = 0; i < processes.length; i++) {
				const p = processes[i];
				lines.push(`${i + 1}. ${p.functionName ?? "Unknown"}`);
				lines.push(`   Status: ${p.processStatus ?? "Unknown"}`);
				lines.push(`   Started: ${p.startTime ?? "Unknown"}`);
				lines.push(`   Duration: ${p.duration ?? "Unknown"}`);
				lines.push("");
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 10. delete_script_project (Drive API) ────────────────────────────────
	server.tool(
		"delete_script_project",
		"Permanently deletes an Apps Script project. Uses Drive API. This action is irreversible.",
		{
			script_id: z.string().describe("The script project ID to delete."),
		},
		async ({ script_id }) => {
			const { accessToken } = await ctx.getService("gdrive");
			await googleApiFetch(
				accessToken,
				`${DRIVE_BASE}/files/${encodeURIComponent(script_id)}`,
				{ method: "DELETE" },
			);
			return {
				content: [
					{
						type: "text" as const,
						text: `Deleted Apps Script project: ${script_id}`,
					},
				],
			};
		},
	);

	// ── 11. list_versions (Script API) ───────────────────────────────────────
	server.tool(
		"list_versions",
		"Lists all immutable versions of an Apps Script project.",
		{
			script_id: z.string().describe("The script project ID."),
		},
		async ({ script_id }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const dataRaw = await googleApiFetch(
				accessToken,
				`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/versions`,
			);
			const data = dataRaw as VersionsListResponse;
			const versions = data.versions ?? [];
			if (versions.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No versions found for script: ${script_id}`,
						},
					],
				};
			}
			const lines = [`Versions for script: ${script_id}`, ""];
			for (const v of versions) {
				lines.push(
					`Version ${v.versionNumber ?? "Unknown"}: ${v.description ?? "No description"}`,
				);
				lines.push(`   Created: ${v.createTime ?? "Unknown"}`);
				lines.push("");
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 12. create_version (Script API) ──────────────────────────────────────
	server.tool(
		"create_version",
		"Creates a new immutable version snapshot of an Apps Script project. Versions cannot be modified after creation.",
		{
			script_id: z.string().describe("The script project ID."),
			description: z
				.string()
				.optional()
				.describe("Optional description for this version."),
		},
		async ({ script_id, description }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const body: Record<string, string> = {};
			if (description) body.description = description;
			const versionRaw = await googleApiFetch(
				accessToken,
				`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/versions`,
				{ method: "POST", body: JSON.stringify(body) },
			);
			const version = versionRaw as Version;
			const text = [
				`Created version ${version.versionNumber ?? "Unknown"} for script: ${script_id}`,
				`Description: ${description ?? "No description"}`,
				`Created: ${version.createTime ?? "Unknown"}`,
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 13. get_version (Script API) ─────────────────────────────────────────
	server.tool(
		"get_version",
		"Gets details of a specific version of an Apps Script project.",
		{
			script_id: z.string().describe("The script project ID."),
			version_number: z
				.number()
				.int()
				.describe("The version number to retrieve (1, 2, 3, etc.)."),
		},
		async ({ script_id, version_number }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const versionRaw = await googleApiFetch(
				accessToken,
				`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/versions/${version_number}`,
			);
			const version = versionRaw as Version;
			const text = [
				`Version ${version.versionNumber ?? "Unknown"} of script: ${script_id}`,
				`Description: ${version.description ?? "No description"}`,
				`Created: ${version.createTime ?? "Unknown"}`,
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 14. get_script_metrics (Script API) ──────────────────────────────────
	server.tool(
		"get_script_metrics",
		"Gets execution metrics (active users, total executions, failed executions) for an Apps Script project.",
		{
			script_id: z.string().describe("The script project ID."),
			metrics_granularity: z
				.enum(["DAILY", "WEEKLY"])
				.default("DAILY")
				.describe('Granularity of returned metrics: "DAILY" or "WEEKLY".'),
		},
		async ({ script_id, metrics_granularity }) => {
			const { accessToken } = await ctx.getService("gappsscript");
			const url = buildUrl(
				`${SCRIPT_BASE}/projects/${encodeURIComponent(script_id)}/metrics`,
				{ metricsGranularity: metrics_granularity },
			);
			const dataRaw = await googleApiFetch(accessToken, url);
			const data = dataRaw as ScriptMetrics;
			const lines = [
				`Metrics for script: ${script_id}`,
				`Granularity: ${metrics_granularity}`,
				"",
			];
			const activeUsers = data.activeUsers ?? [];
			const totalExecutions = data.totalExecutions ?? [];
			const failedExecutions = data.failedExecutions ?? [];

			if (activeUsers.length > 0) {
				lines.push("Active Users:");
				for (const m of activeUsers) {
					lines.push(
						`  ${m.startTime ?? "Unknown"} to ${m.endTime ?? "Unknown"}: ${m.value ?? "0"} users`,
					);
				}
				lines.push("");
			}
			if (totalExecutions.length > 0) {
				lines.push("Total Executions:");
				for (const m of totalExecutions) {
					lines.push(
						`  ${m.startTime ?? "Unknown"} to ${m.endTime ?? "Unknown"}: ${m.value ?? "0"} executions`,
					);
				}
				lines.push("");
			}
			if (failedExecutions.length > 0) {
				lines.push("Failed Executions:");
				for (const m of failedExecutions) {
					lines.push(
						`  ${m.startTime ?? "Unknown"} to ${m.endTime ?? "Unknown"}: ${m.value ?? "0"} failures`,
					);
				}
				lines.push("");
			}
			if (
				activeUsers.length === 0 &&
				totalExecutions.length === 0 &&
				failedExecutions.length === 0
			) {
				lines.push("No metrics data available for this script.");
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 15. generate_trigger_code (no API call) ───────────────────────────────
	server.tool(
		"generate_trigger_code",
		"Generates Apps Script trigger setup code. Makes NO API call — returns code to copy into your script project.",
		{
			trigger_type: z
				.enum([
					"time_minutes",
					"time_hours",
					"time_daily",
					"time_weekly",
					"on_open",
					"on_edit",
					"on_form_submit",
					"on_change",
				])
				.describe(
					'Trigger type: "time_minutes" (every N min), "time_hours" (every N hr), "time_daily" (daily at hour), "time_weekly" (weekly on day), "on_open", "on_edit", "on_form_submit", "on_change".',
				),
			function_name: z
				.string()
				.describe("The Apps Script function to run when the trigger fires."),
			schedule: z
				.string()
				.default("")
				.describe(
					"Schedule detail: for time_minutes '1'/'5'/'10'/'15'/'30'; for time_hours '1'/'2'/'4'/'6'/'8'/'12'; for time_daily hour '0'-'23'; for time_weekly 'MONDAY'/'TUESDAY' etc. Not used for simple triggers.",
				),
		},
		async ({ trigger_type, function_name, schedule }) => {
			const text = generateTriggerCodeImpl(
				trigger_type,
				function_name,
				schedule,
			);
			return { content: [{ type: "text" as const, text }] };
		},
	);
}
