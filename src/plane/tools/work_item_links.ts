import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { workItems } from "../resources/work_items";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

export function registerWorkItemLinkTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_work_item_links",
		"List links for a work item.",
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
				const response = await workItems.listLinks(
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
		"retrieve_work_item_link",
		"Retrieve a specific link for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			link_id: z.string().describe("UUID of the link"),
		},
		async (args) =>
			toolResult(() =>
				workItems.retrieveLink(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					args.link_id,
				),
			),
	);

	server.tool(
		"create_work_item_link",
		"Create a link for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			url: z.string().describe("URL of the link"),
		},
		async (args) =>
			toolResult(() =>
				workItems.createLink(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					{ url: args.url },
				),
			),
	);

	server.tool(
		"update_work_item_link",
		"Update a link for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			link_id: z.string().describe("UUID of the link"),
			url: z.string().optional().describe("Updated URL of the link"),
		},
		async (args) =>
			toolResult(() =>
				workItems.updateLink(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					args.link_id,
					{ url: args.url },
				),
			),
	);

	server.tool(
		"delete_work_item_link",
		"Delete a link for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			link_id: z.string().describe("UUID of the link"),
		},
		async (args) =>
			toolResult(() =>
				workItems.deleteLink(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					args.link_id,
				),
			),
	);
}
