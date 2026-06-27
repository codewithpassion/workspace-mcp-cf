import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { labels } from "../resources/labels";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

export function registerLabelTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_labels",
		"List all labels in a project.",
		{
			...projectIdField(ctx),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (input) =>
			toolResult(async () => {
				const response = await labels.list(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"create_label",
		"Create a new label.",
		{
			...projectIdField(ctx),
			name: z.string().describe("Label name"),
			color: z.string().optional().describe("Label color (hex color code)"),
			description: z.string().optional().describe("Label description"),
			parent: z
				.string()
				.optional()
				.describe("UUID of the parent label (for nested labels)"),
			sort_order: z.number().optional().describe("Sort order for the label"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (input) =>
			toolResult(() =>
				labels.create(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					{
						name: input.name,
						color: input.color,
						description: input.description,
						parent: input.parent,
						sort_order: input.sort_order,
						external_source: input.external_source,
						external_id: input.external_id,
					},
				),
			),
	);

	server.tool(
		"retrieve_label",
		"Retrieve a label by ID.",
		{
			...projectIdField(ctx),
			label_id: z.string().describe("UUID of the label"),
		},
		async (input) =>
			toolResult(() =>
				labels.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.label_id,
				),
			),
	);

	server.tool(
		"update_label",
		"Update a label by ID.",
		{
			...projectIdField(ctx),
			label_id: z.string().describe("UUID of the label"),
			name: z.string().optional().describe("Label name"),
			color: z.string().optional().describe("Label color (hex color code)"),
			description: z.string().optional().describe("Label description"),
			parent: z
				.string()
				.optional()
				.describe("UUID of the parent label (for nested labels)"),
			sort_order: z.number().optional().describe("Sort order for the label"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (input) =>
			toolResult(() =>
				labels.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.label_id,
					{
						name: input.name,
						color: input.color,
						description: input.description,
						parent: input.parent,
						sort_order: input.sort_order,
						external_source: input.external_source,
						external_id: input.external_id,
					},
				),
			),
	);

	server.tool(
		"delete_label",
		"Delete a label by ID.",
		{
			...projectIdField(ctx),
			label_id: z.string().describe("UUID of the label"),
		},
		async (input) =>
			toolResult(() =>
				labels.delete(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.label_id,
				),
			),
	);
}
