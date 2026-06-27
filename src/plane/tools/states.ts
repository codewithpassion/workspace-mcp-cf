import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { states } from "../resources/states";
import type { StateGroupEnum } from "../types/common";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

const STATE_GROUPS: readonly StateGroupEnum[] = [
	"backlog",
	"unstarted",
	"started",
	"completed",
	"cancelled",
	"triage",
];

function validateGroup(group: string | undefined): StateGroupEnum | undefined {
	if (group && (STATE_GROUPS as readonly string[]).includes(group)) {
		return group as StateGroupEnum;
	}
	return undefined;
}

export function registerStateTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_states",
		"List all states in a project.",
		{
			...projectIdField(ctx),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (input) =>
			toolResult(async () => {
				const response = await states.list(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.params ?? null,
				);
				return response.results;
			}),
	);

	server.tool(
		"create_state",
		"Create a new state.",
		{
			...projectIdField(ctx),
			name: z.string().describe("State name"),
			color: z.string().describe("State color (hex color code)"),
			description: z.string().optional().describe("State description"),
			sequence: z.number().optional().describe("State sequence order"),
			group: z
				.string()
				.optional()
				.describe(
					"State group (e.g., backlog, unstarted, started, completed, cancelled)",
				),
			is_triage: z
				.boolean()
				.optional()
				.describe("Whether this is a triage state"),
			default: z
				.boolean()
				.optional()
				.describe("Whether this is the default state"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (input) =>
			toolResult(() =>
				states.create(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					{
						name: input.name,
						color: input.color,
						description: input.description,
						sequence: input.sequence,
						group: validateGroup(input.group),
						is_triage: input.is_triage,
						default: input.default,
						external_source: input.external_source,
						external_id: input.external_id,
					},
				),
			),
	);

	server.tool(
		"retrieve_state",
		"Retrieve a state by ID.",
		{
			...projectIdField(ctx),
			state_id: z.string().describe("UUID of the state"),
		},
		async (input) =>
			toolResult(() =>
				states.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.state_id,
				),
			),
	);

	server.tool(
		"update_state",
		"Update a state by ID.",
		{
			...projectIdField(ctx),
			state_id: z.string().describe("UUID of the state"),
			name: z.string().optional().describe("State name"),
			color: z.string().optional().describe("State color (hex color code)"),
			description: z.string().optional().describe("State description"),
			sequence: z.number().optional().describe("State sequence order"),
			group: z
				.string()
				.optional()
				.describe(
					"State group (e.g., backlog, unstarted, started, completed, cancelled)",
				),
			is_triage: z
				.boolean()
				.optional()
				.describe("Whether this is a triage state"),
			default: z
				.boolean()
				.optional()
				.describe("Whether this is the default state"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (input) =>
			toolResult(() =>
				states.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.state_id,
					{
						name: input.name,
						color: input.color,
						description: input.description,
						sequence: input.sequence,
						group: validateGroup(input.group),
						is_triage: input.is_triage,
						default: input.default,
						external_source: input.external_source,
						external_id: input.external_id,
					},
				),
			),
	);

	server.tool(
		"delete_state",
		"Delete a state by ID.",
		{
			...projectIdField(ctx),
			state_id: z.string().describe("UUID of the state"),
		},
		async (input) =>
			toolResult(() =>
				states.delete(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.state_id,
				),
			),
	);
}
