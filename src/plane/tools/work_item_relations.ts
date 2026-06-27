import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { workItems } from "../resources/work_items";
import type { WorkItemRelationTypeEnum } from "../types/common";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

const RELATION_TYPES: WorkItemRelationTypeEnum[] = [
	"blocking",
	"blocked_by",
	"duplicate",
	"relates_to",
	"start_before",
	"start_after",
	"finish_before",
	"finish_after",
];

export function registerWorkItemRelationTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_work_item_relations",
		"List relations for a work item. Returns lists of related work items by relation type: blocking, blocked_by, duplicate, relates_to, start_after, start_before, finish_after, finish_before.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
		},
		async (args) =>
			toolResult(() =>
				workItems.listRelations(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
				),
			),
	);

	server.tool(
		"create_work_item_relation",
		"Create relations for a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			relation_type: z
				.string()
				.describe(
					"Type of relationship (blocking, blocked_by, duplicate, relates_to, start_before, start_after, finish_before, finish_after)",
				),
			issues: z
				.array(z.string())
				.describe("List of work item IDs to create relations with"),
		},
		async (args) =>
			toolResult(() => {
				if (
					!RELATION_TYPES.includes(
						args.relation_type as WorkItemRelationTypeEnum,
					)
				) {
					throw new Error(
						`Invalid relation_type '${args.relation_type}'. Must be one of: ${RELATION_TYPES.join(", ")}`,
					);
				}
				return workItems.createRelation(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					{
						relation_type: args.relation_type as WorkItemRelationTypeEnum,
						issues: args.issues,
					},
				);
			}),
	);

	server.tool(
		"remove_work_item_relation",
		"Remove a relation from a work item.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			related_issue: z
				.string()
				.describe("UUID of the related work item to remove relation with"),
		},
		async (args) =>
			toolResult(() =>
				workItems.removeRelation(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, args),
					args.work_item_id,
					{ related_issue: args.related_issue },
				),
			),
	);
}
