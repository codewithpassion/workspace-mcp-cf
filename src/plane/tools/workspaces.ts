import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { workspaces } from "../resources/workspaces";
import type { WorkspaceFeature } from "../types/workspaces";
import { toolResult } from "./_helpers";

export function registerWorkspaceTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"get_workspace_members",
		"Get all members of the current workspace.",
		{},
		async () =>
			toolResult(() => workspaces.getMembers(ctx.config, ctx.workspaceSlug)),
	);

	server.tool(
		"get_workspace_features",
		"Get features of the current workspace.",
		{},
		async () =>
			toolResult(() => workspaces.getFeatures(ctx.config, ctx.workspaceSlug)),
	);

	server.tool(
		"update_workspace_features",
		"Update features of the current workspace.",
		{
			project_grouping: z
				.boolean()
				.optional()
				.describe("Enable/disable project grouping feature"),
			initiatives: z
				.boolean()
				.optional()
				.describe("Enable/disable initiatives feature"),
			teams: z.boolean().optional().describe("Enable/disable teams feature"),
			customers: z
				.boolean()
				.optional()
				.describe("Enable/disable customers feature"),
			wiki: z.boolean().optional().describe("Enable/disable wiki feature"),
			pi: z
				.boolean()
				.optional()
				.describe("Enable/disable PI (Program Increment) feature"),
		},
		async (params) =>
			toolResult(() => {
				const body: WorkspaceFeature = {};
				if (params.project_grouping !== undefined)
					body.project_grouping = params.project_grouping;
				if (params.initiatives !== undefined)
					body.initiatives = params.initiatives;
				if (params.teams !== undefined) body.teams = params.teams;
				if (params.customers !== undefined) body.customers = params.customers;
				if (params.wiki !== undefined) body.wiki = params.wiki;
				if (params.pi !== undefined) body.pi = params.pi;
				return workspaces.updateFeatures(ctx.config, ctx.workspaceSlug, body);
			}),
	);
}
