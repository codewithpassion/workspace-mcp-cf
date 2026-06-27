import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { cycles } from "../resources/cycles";
import type { CreateCycleBody, UpdateCycleBody } from "../types/cycles";
import {
	projectIdField,
	requireProjectId,
	toolResult,
	toolResultWithUrl,
} from "./_helpers";

export function registerCycleTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_cycles",
		"List all cycles in a project.",
		{
			...projectIdField(ctx),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (params) =>
			toolResultWithUrl("cycle", ctx, async () => {
				const response = await cycles.list(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"create_cycle",
		"Create a new cycle.",
		{
			...projectIdField(ctx),
			name: z.string().describe("Cycle name"),
			owned_by: z.string().describe("UUID of the user who owns the cycle"),
			description: z.string().optional().describe("Cycle description"),
			start_date: z
				.string()
				.optional()
				.describe("Cycle start date (ISO 8601 format)"),
			end_date: z
				.string()
				.optional()
				.describe("Cycle end date (ISO 8601 format)"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
			timezone: z.string().optional().describe("Cycle timezone"),
		},
		async (params) =>
			toolResultWithUrl("cycle", ctx, () => {
				const data: CreateCycleBody = {
					name: params.name,
					owned_by: params.owned_by,
					project_id: requireProjectId(ctx, params),
					description: params.description,
					start_date: params.start_date,
					end_date: params.end_date,
					external_source: params.external_source,
					external_id: params.external_id,
					timezone: params.timezone,
				};
				return cycles.create(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					data,
				);
			}),
	);

	server.tool(
		"retrieve_cycle",
		"Retrieve a cycle by ID.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the cycle"),
		},
		async (params) =>
			toolResultWithUrl("cycle", ctx, () =>
				cycles.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
				),
			),
	);

	server.tool(
		"update_cycle",
		"Update a cycle by ID.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the cycle"),
			name: z.string().optional().describe("Cycle name"),
			description: z.string().optional().describe("Cycle description"),
			start_date: z
				.string()
				.optional()
				.describe("Cycle start date (ISO 8601 format)"),
			end_date: z
				.string()
				.optional()
				.describe("Cycle end date (ISO 8601 format)"),
			owned_by: z
				.string()
				.optional()
				.describe("UUID of the user who owns the cycle"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
			timezone: z.string().optional().describe("Cycle timezone"),
		},
		async (params) =>
			toolResult(() => {
				const data: UpdateCycleBody = {
					name: params.name,
					description: params.description,
					start_date: params.start_date,
					end_date: params.end_date,
					owned_by: params.owned_by,
					external_source: params.external_source,
					external_id: params.external_id,
					timezone: params.timezone,
				};
				return cycles.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
					data,
				);
			}),
	);

	server.tool(
		"delete_cycle",
		"Delete a cycle by ID.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the cycle"),
		},
		async (params) =>
			toolResult(() =>
				cycles.delete(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
				),
			),
	);

	server.tool(
		"list_archived_cycles",
		"List archived cycles in a project.",
		{
			...projectIdField(ctx),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (params) =>
			toolResultWithUrl("cycle", ctx, async () => {
				const response = await cycles.listArchived(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"add_work_items_to_cycle",
		"Add work items to a cycle.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the cycle"),
			work_item_ids: z
				.array(z.string())
				.describe("List of work item UUIDs to add to the cycle"),
		},
		async (params) =>
			toolResult(() =>
				cycles.addWorkItems(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
					params.work_item_ids,
				),
			),
	);

	server.tool(
		"remove_work_item_from_cycle",
		"Remove a work item from a cycle.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the cycle"),
			work_item_id: z.string().describe("UUID of the work item to remove"),
		},
		async (params) =>
			toolResult(() =>
				cycles.removeWorkItem(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
					params.work_item_id,
				),
			),
	);

	server.tool(
		"list_cycle_work_items",
		"List work items in a cycle.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the cycle"),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (params) =>
			toolResultWithUrl("work_item", ctx, async () => {
				const response = await cycles.listWorkItems(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
					params.params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"transfer_cycle_work_items",
		"Transfer work items from one cycle to another.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the source cycle"),
			new_cycle_id: z
				.string()
				.describe("UUID of the target cycle to transfer issues to"),
		},
		async (params) =>
			toolResult(() =>
				cycles.transferWorkItems(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
					{ new_cycle_id: params.new_cycle_id },
				),
			),
	);

	server.tool(
		"archive_cycle",
		"Archive a cycle.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the cycle"),
		},
		async (params) =>
			toolResult(async () => {
				await cycles.archive(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
				);
				return true;
			}),
	);

	server.tool(
		"unarchive_cycle",
		"Unarchive a cycle.",
		{
			...projectIdField(ctx),
			cycle_id: z.string().describe("UUID of the cycle"),
		},
		async (params) =>
			toolResult(async () => {
				await cycles.unarchive(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.cycle_id,
				);
				return true;
			}),
	);
}
