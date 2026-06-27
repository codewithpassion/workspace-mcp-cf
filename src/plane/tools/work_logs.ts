import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { workLogs } from "../resources/work_logs";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

export function registerWorkLogTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_work_logs",
		"List work logs for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (input) =>
			toolResult(() =>
				workLogs.list(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.work_item_id,
					input.params ?? null,
				),
			),
	);

	server.tool(
		"create_work_log",
		"Create a work log for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			duration: z
				.number()
				.int()
				.optional()
				.describe("Duration of work in minutes"),
			description: z
				.string()
				.optional()
				.describe("Description of the work performed"),
		},
		async (input) =>
			toolResult(() =>
				workLogs.create(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.work_item_id,
					{ duration: input.duration, description: input.description },
				),
			),
	);

	server.tool(
		"update_work_log",
		"Update a work log for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			work_log_id: z.string().describe("UUID of the work log"),
			duration: z
				.number()
				.int()
				.optional()
				.describe("Duration of work in minutes"),
			description: z
				.string()
				.optional()
				.describe("Description of the work performed"),
		},
		async (input) =>
			toolResult(() =>
				workLogs.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.work_item_id,
					input.work_log_id,
					{ duration: input.duration, description: input.description },
				),
			),
	);

	server.tool(
		"delete_work_log",
		"Delete a work log for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			work_log_id: z.string().describe("UUID of the work log"),
		},
		async (input) =>
			toolResult(() =>
				workLogs.delete(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.work_item_id,
					input.work_log_id,
				),
			),
	);
}
