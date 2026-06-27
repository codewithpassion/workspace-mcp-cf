import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { milestones } from "../resources/milestones";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

export function registerMilestoneTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_milestones",
		"List all milestones in a project.",
		{
			...projectIdField(ctx),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (input) =>
			toolResult(async () => {
				const response = await milestones.list(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"create_milestone",
		"Create a new milestone.",
		{
			...projectIdField(ctx),
			title: z.string().describe("Milestone title"),
			target_date: z
				.string()
				.optional()
				.describe("Target date for the milestone (ISO 8601 format)"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (input) =>
			toolResult(() =>
				milestones.create(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					{
						title: input.title,
						target_date: input.target_date,
						external_source: input.external_source,
						external_id: input.external_id,
					},
				),
			),
	);

	server.tool(
		"retrieve_milestone",
		"Retrieve a milestone by ID.",
		{
			...projectIdField(ctx),
			milestone_id: z.string().describe("UUID of the milestone"),
		},
		async (input) =>
			toolResult(() =>
				milestones.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.milestone_id,
				),
			),
	);

	server.tool(
		"update_milestone",
		"Update a milestone by ID.",
		{
			...projectIdField(ctx),
			milestone_id: z.string().describe("UUID of the milestone"),
			title: z.string().optional().describe("Milestone title"),
			target_date: z
				.string()
				.optional()
				.describe("Target date for the milestone (ISO 8601 format)"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (input) =>
			toolResult(() =>
				milestones.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.milestone_id,
					{
						title: input.title,
						target_date: input.target_date,
						external_source: input.external_source,
						external_id: input.external_id,
					},
				),
			),
	);

	server.tool(
		"delete_milestone",
		"Delete a milestone by ID.",
		{
			...projectIdField(ctx),
			milestone_id: z.string().describe("UUID of the milestone"),
		},
		async (input) =>
			toolResult(() =>
				milestones.delete(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.milestone_id,
				),
			),
	);

	server.tool(
		"add_work_items_to_milestone",
		"Add work items to a milestone.",
		{
			...projectIdField(ctx),
			milestone_id: z.string().describe("UUID of the milestone"),
			work_item_ids: z
				.array(z.string())
				.describe("List of work item UUIDs to add to the milestone"),
		},
		async (input) =>
			toolResult(() =>
				milestones.addWorkItems(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.milestone_id,
					input.work_item_ids,
				),
			),
	);

	server.tool(
		"remove_work_items_from_milestone",
		"Remove work items from a milestone.",
		{
			...projectIdField(ctx),
			milestone_id: z.string().describe("UUID of the milestone"),
			work_item_ids: z
				.array(z.string())
				.describe("List of work item UUIDs to remove from the milestone"),
		},
		async (input) =>
			toolResult(() =>
				milestones.removeWorkItems(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.milestone_id,
					input.work_item_ids,
				),
			),
	);

	server.tool(
		"list_milestone_work_items",
		"List work items in a milestone.",
		{
			...projectIdField(ctx),
			milestone_id: z.string().describe("UUID of the milestone"),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (input) =>
			toolResult(async () => {
				const response = await milestones.listWorkItems(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.milestone_id,
					input.params ?? null,
				);
				return response.results;
			}),
	);
}
