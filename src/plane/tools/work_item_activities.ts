import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { workItems } from "../resources/work_items";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

export function registerWorkItemActivityTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_work_item_activities",
		"List activities for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (args) =>
			toolResult(async () => {
				const response = await workItems.listActivities(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					args.params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"retrieve_work_item_activity",
		"Retrieve a specific activity for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			activity_id: z.string().describe("UUID of the activity"),
		},
		async (args) =>
			toolResult(() =>
				workItems.retrieveActivity(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					args.activity_id,
				),
			),
	);
}
