import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { initiatives } from "../resources/initiatives";
import { toolResult, toolResultWithUrl } from "./_helpers";

export function registerInitiativeTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_initiatives",
		"List all initiatives in a workspace.",
		{
			params: z
				.record(z.unknown())
				.optional()
				.describe(
					"Optional query parameters as a dictionary (e.g., per_page, cursor)",
				),
		},
		async ({ params }) =>
			toolResultWithUrl("initiative", ctx, async () => {
				const response = await initiatives.list(
					ctx.config,
					ctx.workspaceSlug,
					params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"create_initiative",
		"Create a new initiative in the workspace.",
		{
			name: z.string().describe("Initiative name"),
			description_html: z
				.string()
				.optional()
				.describe("HTML description of the initiative"),
			start_date: z
				.string()
				.optional()
				.describe("Initiative start date (ISO 8601 format)"),
			end_date: z
				.string()
				.optional()
				.describe("Initiative end date (ISO 8601 format)"),
			logo_props: z
				.record(z.unknown())
				.optional()
				.describe("Logo properties dictionary"),
			state: z
				.string()
				.optional()
				.describe(
					"Initiative state (DRAFT, PLANNED, ACTIVE, COMPLETED, CLOSED)",
				),
			lead: z
				.string()
				.optional()
				.describe("UUID of the user who leads the initiative"),
		},
		async ({
			name,
			description_html,
			start_date,
			end_date,
			logo_props,
			state,
			lead,
		}) =>
			toolResultWithUrl("initiative", ctx, () =>
				initiatives.create(ctx.config, ctx.workspaceSlug, {
					name,
					description_html,
					start_date,
					end_date,
					logo_props,
					state,
					lead,
				}),
			),
	);

	server.tool(
		"retrieve_initiative",
		"Retrieve an initiative by ID.",
		{
			initiative_id: z.string().describe("UUID of the initiative"),
		},
		async ({ initiative_id }) =>
			toolResultWithUrl("initiative", ctx, () =>
				initiatives.retrieve(ctx.config, ctx.workspaceSlug, initiative_id),
			),
	);

	server.tool(
		"update_initiative",
		"Update an initiative by ID.",
		{
			initiative_id: z.string().describe("UUID of the initiative"),
			name: z.string().optional().describe("Initiative name"),
			description_html: z
				.string()
				.optional()
				.describe("HTML description of the initiative"),
			start_date: z
				.string()
				.optional()
				.describe("Initiative start date (ISO 8601 format)"),
			end_date: z
				.string()
				.optional()
				.describe("Initiative end date (ISO 8601 format)"),
			logo_props: z
				.record(z.unknown())
				.optional()
				.describe("Logo properties dictionary"),
			state: z
				.string()
				.optional()
				.describe(
					"Initiative state (DRAFT, PLANNED, ACTIVE, COMPLETED, CLOSED)",
				),
			lead: z
				.string()
				.optional()
				.describe("UUID of the user who leads the initiative"),
		},
		async ({ initiative_id, ...rest }) =>
			toolResult(() =>
				initiatives.update(ctx.config, ctx.workspaceSlug, initiative_id, rest),
			),
	);

	server.tool(
		"delete_initiative",
		"Delete an initiative by ID.",
		{
			initiative_id: z.string().describe("UUID of the initiative"),
		},
		async ({ initiative_id }) =>
			toolResult(() =>
				initiatives.delete(ctx.config, ctx.workspaceSlug, initiative_id),
			),
	);
}
