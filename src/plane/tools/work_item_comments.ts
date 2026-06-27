import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { workItems } from "../resources/work_items";
import type { AccessEnum } from "../types/common";
import type {
	CreateWorkItemCommentBody,
	UpdateWorkItemCommentBody,
} from "../types/work_item_comments";
import {
	projectIdField,
	requireProjectId,
	stripNullish,
	toolResult,
} from "./_helpers";

export function registerWorkItemCommentTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_work_item_comments",
		"List comments for a work item.",
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
				const response = await workItems.listComments(
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
		"retrieve_work_item_comment",
		"Retrieve a specific comment for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			comment_id: z.string().describe("UUID of the comment"),
		},
		async (args) =>
			toolResult(() =>
				workItems.retrieveComment(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					args.comment_id,
				),
			),
	);

	server.tool(
		"create_work_item_comment",
		"Create a comment for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			comment_html: z
				.string()
				.optional()
				.describe("Comment content in HTML format"),
			comment_json: z
				.record(z.unknown())
				.optional()
				.describe("Comment content in JSON format"),
			access: z
				.string()
				.optional()
				.describe("Access level for the comment (INTERNAL or EXTERNAL)"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (args) =>
			toolResult(() => {
				const data: CreateWorkItemCommentBody = stripNullish({
					comment_html: args.comment_html,
					comment_json: args.comment_json,
					access: args.access as AccessEnum | undefined,
					external_source: args.external_source,
					external_id: args.external_id,
				});
				return workItems.createComment(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					data,
				);
			}),
	);

	server.tool(
		"update_work_item_comment",
		"Update a comment for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			comment_id: z.string().describe("UUID of the comment"),
			comment_html: z
				.string()
				.optional()
				.describe("Comment content in HTML format"),
			comment_json: z
				.record(z.unknown())
				.optional()
				.describe("Comment content in JSON format"),
			access: z
				.string()
				.optional()
				.describe("Access level for the comment (INTERNAL or EXTERNAL)"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (args) =>
			toolResult(() => {
				const data: UpdateWorkItemCommentBody = stripNullish({
					comment_html: args.comment_html,
					comment_json: args.comment_json,
					access: args.access as AccessEnum | undefined,
					external_source: args.external_source,
					external_id: args.external_id,
				});
				return workItems.updateComment(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					args.comment_id,
					data,
				);
			}),
	);

	server.tool(
		"delete_work_item_comment",
		"Delete a comment for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			comment_id: z.string().describe("UUID of the comment"),
		},
		async (args) =>
			toolResult(() =>
				workItems.deleteComment(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					args.comment_id,
				),
			),
	);
}
