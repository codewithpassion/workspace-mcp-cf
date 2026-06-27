import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { intake } from "../resources/intake";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

export function registerIntakeTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_intake_work_items",
		"List all intake work items in a project.",
		{
			...projectIdField(ctx),
			params: z
				.record(z.unknown())
				.optional()
				.describe(
					"Optional query parameters as a dictionary (e.g., per_page, cursor)",
				),
		},
		async (input) =>
			toolResult(async () => {
				const response = await intake.list(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"create_intake_work_item",
		"Create a new intake work item in a project.",
		{
			...projectIdField(ctx),
			data: z
				.record(z.unknown())
				.describe("Intake work item data as a dictionary"),
		},
		async (input) =>
			toolResult(() =>
				intake.create(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.data,
				),
			),
	);

	server.tool(
		"retrieve_intake_work_item",
		"Retrieve an intake work item by work item ID.",
		{
			...projectIdField(ctx),
			work_item_id: z
				.string()
				.describe(
					"UUID of the work item (use the issue field from IntakeWorkItem response, not the intake work item ID)",
				),
			params: z
				.record(z.unknown())
				.optional()
				.describe(
					"Optional query parameters as a dictionary (e.g., expand, fields)",
				),
		},
		async (input) =>
			toolResult(() =>
				intake.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.work_item_id,
					input.params ?? null,
				),
			),
	);

	server.tool(
		"update_intake_work_item",
		"Update an intake work item by work item ID.",
		{
			...projectIdField(ctx),
			work_item_id: z
				.string()
				.describe(
					"UUID of the work item (use the issue field from IntakeWorkItem response, not the intake work item ID)",
				),
			data: z
				.record(z.unknown())
				.describe("Updated intake work item data as a dictionary"),
		},
		async (input) =>
			toolResult(() =>
				intake.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.work_item_id,
					input.data,
				),
			),
	);

	server.tool(
		"delete_intake_work_item",
		"Delete an intake work item by work item ID.",
		{
			...projectIdField(ctx),
			work_item_id: z
				.string()
				.describe(
					"UUID of the work item (use the issue field from IntakeWorkItem response, not the intake work item ID)",
				),
		},
		async (input) =>
			toolResult(() =>
				intake.delete(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.work_item_id,
				),
			),
	);
}
