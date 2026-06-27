import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { projects } from "../resources/projects";
import type { PaginatedQueryParams } from "../types/common";
import type {
	CreateProjectBody,
	ProjectFeature,
	UpdateProjectBody,
} from "../types/projects";
import {
	projectIdField,
	requireProjectId,
	toolResult,
	toolResultWithUrl,
} from "./_helpers";

export function registerProjectTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	const pinned = Boolean(ctx.projectId);

	if (!pinned) {
		server.tool(
			"list_projects",
			"List all projects in a workspace.",
			{
				cursor: z
					.string()
					.optional()
					.describe("Pagination cursor for getting next set of results"),
				per_page: z
					.number()
					.int()
					.optional()
					.describe("Number of results per page (1-100)"),
				expand: z
					.string()
					.optional()
					.describe(
						"Comma-separated list of related fields to expand in response",
					),
				fields: z
					.string()
					.optional()
					.describe("Comma-separated list of fields to include in response"),
				order_by: z
					.string()
					.optional()
					.describe(
						"Field to order results by. Prefix with '-' for descending order",
					),
			},
			async (params) =>
				toolResultWithUrl("project", ctx, async () => {
					const queryParams: PaginatedQueryParams = {
						cursor: params.cursor,
						per_page: params.per_page,
						expand: params.expand,
						fields: params.fields,
						order_by: params.order_by,
					};
					const response = await projects.list(
						ctx.config,
						ctx.workspaceSlug,
						queryParams,
					);
					return response.results;
				}),
		);

		server.tool(
			"create_project",
			"Create a new project.",
			{
				name: z.string().describe("Project name"),
				identifier: z
					.string()
					.describe('Project identifier (e.g., "MP" for "My Project")'),
				description: z.string().optional().describe("Project description"),
				project_lead: z
					.string()
					.optional()
					.describe("UUID of the project lead user"),
				default_assignee: z
					.string()
					.optional()
					.describe("UUID of the default assignee user"),
				emoji: z.string().optional().describe("Emoji for the project"),
				cover_image: z
					.string()
					.optional()
					.describe("Cover image URL or asset ID"),
				module_view: z.boolean().optional().describe("Enable module view"),
				cycle_view: z.boolean().optional().describe("Enable cycle view"),
				issue_views_view: z
					.boolean()
					.optional()
					.describe("Enable issue views view"),
				page_view: z.boolean().optional().describe("Enable page view"),
				intake_view: z.boolean().optional().describe("Enable intake view"),
				guest_view_all_features: z
					.boolean()
					.optional()
					.describe("Allow guests to view all features"),
				archive_in: z
					.number()
					.int()
					.optional()
					.describe("Days until auto-archive"),
				close_in: z.number().int().optional().describe("Days until auto-close"),
				timezone: z.string().optional().describe("Project timezone"),
				external_source: z
					.string()
					.optional()
					.describe("External system source name"),
				external_id: z
					.string()
					.optional()
					.describe("External system identifier"),
				is_issue_type_enabled: z
					.boolean()
					.optional()
					.describe("Enable issue types"),
			},
			async (params) =>
				toolResultWithUrl("project", ctx, () => {
					const data: CreateProjectBody = {
						name: params.name,
						identifier: params.identifier,
						description: params.description,
						project_lead: params.project_lead,
						default_assignee: params.default_assignee,
						emoji: params.emoji,
						cover_image: params.cover_image,
						module_view: params.module_view,
						cycle_view: params.cycle_view,
						issue_views_view: params.issue_views_view,
						page_view: params.page_view,
						intake_view: params.intake_view,
						guest_view_all_features: params.guest_view_all_features,
						archive_in: params.archive_in,
						close_in: params.close_in,
						timezone: params.timezone,
						external_source: params.external_source,
						external_id: params.external_id,
						is_issue_type_enabled: params.is_issue_type_enabled,
					};
					return projects.create(ctx.config, ctx.workspaceSlug, data);
				}),
		);

		server.tool(
			"delete_project",
			"Delete a project by ID.",
			{ ...projectIdField(ctx) },
			async (params) =>
				toolResult(() =>
					projects.delete(
						ctx.config,
						ctx.workspaceSlug,
						requireProjectId(ctx, params),
					),
				),
		);
	}

	server.tool(
		"retrieve_project",
		pinned ? "Retrieve the configured project." : "Retrieve a project by ID.",
		{ ...projectIdField(ctx) },
		async (params) =>
			toolResultWithUrl("project", ctx, () =>
				projects.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
				),
			),
	);

	server.tool(
		"update_project",
		pinned ? "Update the configured project." : "Update a project by ID.",
		{
			...projectIdField(ctx),
			name: z.string().optional().describe("Project name"),
			description: z.string().optional().describe("Project description"),
			project_lead: z
				.string()
				.optional()
				.describe("UUID of the project lead user"),
			default_assignee: z
				.string()
				.optional()
				.describe("UUID of the default assignee user"),
			identifier: z.string().optional().describe("Project identifier"),
			emoji: z.string().optional().describe("Emoji for the project"),
			cover_image: z
				.string()
				.optional()
				.describe("Cover image URL or asset ID"),
			module_view: z.boolean().optional().describe("Enable module view"),
			cycle_view: z.boolean().optional().describe("Enable cycle view"),
			issue_views_view: z
				.boolean()
				.optional()
				.describe("Enable issue views view"),
			page_view: z.boolean().optional().describe("Enable page view"),
			intake_view: z.boolean().optional().describe("Enable intake view"),
			guest_view_all_features: z
				.boolean()
				.optional()
				.describe("Allow guests to view all features"),
			archive_in: z
				.number()
				.int()
				.optional()
				.describe("Days until auto-archive"),
			close_in: z.number().int().optional().describe("Days until auto-close"),
			timezone: z.string().optional().describe("Project timezone"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
			is_issue_type_enabled: z
				.boolean()
				.optional()
				.describe("Enable issue types"),
			is_time_tracking_enabled: z
				.boolean()
				.optional()
				.describe("Enable time tracking"),
			default_state: z
				.string()
				.optional()
				.describe("UUID of the default state"),
			estimate: z.string().optional().describe("Estimate configuration"),
		},
		async (params) =>
			toolResult(() => {
				const data: UpdateProjectBody = {
					name: params.name,
					description: params.description,
					project_lead: params.project_lead,
					default_assignee: params.default_assignee,
					identifier: params.identifier,
					emoji: params.emoji,
					cover_image: params.cover_image,
					module_view: params.module_view,
					cycle_view: params.cycle_view,
					issue_views_view: params.issue_views_view,
					page_view: params.page_view,
					intake_view: params.intake_view,
					guest_view_all_features: params.guest_view_all_features,
					archive_in: params.archive_in,
					close_in: params.close_in,
					timezone: params.timezone,
					external_source: params.external_source,
					external_id: params.external_id,
					is_issue_type_enabled: params.is_issue_type_enabled,
					is_time_tracking_enabled: params.is_time_tracking_enabled,
					default_state: params.default_state,
					estimate: params.estimate,
				};
				return projects.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					data,
				);
			}),
	);

	server.tool(
		"get_project_worklog_summary",
		"Get work log summary for a project.",
		{ ...projectIdField(ctx) },
		async (params) =>
			toolResult(() =>
				projects.getWorklogSummary(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
				),
			),
	);

	server.tool(
		"get_project_members",
		"Get all members of a project.",
		{
			...projectIdField(ctx),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (params) =>
			toolResult(() =>
				projects.getMembers(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.params ?? null,
				),
			),
	);

	server.tool(
		"get_project_features",
		"Get features of a project.",
		{ ...projectIdField(ctx) },
		async (params) =>
			toolResult(() =>
				projects.getFeatures(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
				),
			),
	);

	server.tool(
		"update_project_features",
		"Update features of a project.",
		{
			...projectIdField(ctx),
			epics: z.boolean().optional().describe("Enable/disable epics feature"),
			modules: z
				.boolean()
				.optional()
				.describe("Enable/disable modules feature"),
			cycles: z.boolean().optional().describe("Enable/disable cycles feature"),
			views: z.boolean().optional().describe("Enable/disable views feature"),
			pages: z.boolean().optional().describe("Enable/disable pages feature"),
			intakes: z
				.boolean()
				.optional()
				.describe("Enable/disable intakes feature"),
			work_item_types: z
				.boolean()
				.optional()
				.describe("Enable/disable work item types feature"),
		},
		async (params) =>
			toolResult(() => {
				const data: ProjectFeature = {
					epics: params.epics,
					modules: params.modules,
					cycles: params.cycles,
					views: params.views,
					pages: params.pages,
					intakes: params.intakes,
					work_item_types: params.work_item_types,
				};
				return projects.updateFeatures(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					data,
				);
			}),
	);
}
