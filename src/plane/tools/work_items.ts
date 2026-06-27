import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { workItems } from "../resources/work_items";
import type { PriorityEnum, WorkItemQueryParams } from "../types/common";
import type {
	AdvancedSearchBody,
	CreateWorkItemBody,
	UpdateWorkItemBody,
} from "../types/work_items";
import {
	projectIdField,
	requireProjectId,
	resolveProjectId,
	stripNullish,
	toolResult,
	toolResultWithUrl,
} from "./_helpers";

function _buildAdvancedSearchFilters(args: {
	assignee_ids?: string[];
	state_ids?: string[];
	state_groups?: string[];
	priorities?: string[];
	label_ids?: string[];
	type_ids?: string[];
	cycle_ids?: string[];
	module_ids?: string[];
	is_archived?: boolean;
	created_by_ids?: string[];
}): Record<string, unknown> | null {
	const conditions: Record<string, unknown>[] = [];
	if (args.assignee_ids?.length)
		conditions.push({ assignee_id__in: args.assignee_ids });
	if (args.state_ids?.length) conditions.push({ state_id__in: args.state_ids });
	if (args.state_groups?.length)
		conditions.push({ state_group__in: args.state_groups });
	if (args.priorities?.length)
		conditions.push({ priority__in: args.priorities });
	if (args.label_ids?.length) conditions.push({ label_id__in: args.label_ids });
	if (args.type_ids?.length) conditions.push({ type_id__in: args.type_ids });
	if (args.cycle_ids?.length) conditions.push({ cycle_id__in: args.cycle_ids });
	if (args.module_ids?.length)
		conditions.push({ module_id__in: args.module_ids });
	if (args.is_archived !== undefined && args.is_archived !== null)
		conditions.push({ is_archived: args.is_archived });
	if (args.created_by_ids?.length)
		conditions.push({ created_by_id__in: args.created_by_ids });
	if (conditions.length === 0) return null;
	if (conditions.length === 1) return conditions[0];
	return { and: conditions };
}

export function registerWorkItemTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_work_items",
		"List work items in a project or search across the workspace. When any filter parameter is provided (assignee_ids, state_ids, state_groups, priorities, label_ids, type_ids, cycle_ids, module_ids, is_archived, created_by_ids, or query), this uses the advanced search endpoint which supports powerful filtering. Otherwise it uses the standard list endpoint.",
		{
			...projectIdField(ctx, {
				optional: true,
				description:
					"UUID of the project. Required when no filters are provided. Optional when using filters (omit for workspace-wide search).",
			}),
			query: z
				.string()
				.optional()
				.describe(
					"Free-form text search across work item name and description",
				),
			assignee_ids: z
				.array(z.string())
				.optional()
				.describe("List of user UUIDs to filter by assignee"),
			state_ids: z
				.array(z.string())
				.optional()
				.describe("List of state UUIDs to filter by state"),
			state_groups: z
				.array(z.string())
				.optional()
				.describe(
					"List of state groups to filter by (backlog, unstarted, started, completed, cancelled)",
				),
			priorities: z
				.array(z.string())
				.optional()
				.describe(
					"List of priority values to filter by (urgent, high, medium, low, none)",
				),
			label_ids: z
				.array(z.string())
				.optional()
				.describe("List of label UUIDs to filter by label"),
			type_ids: z
				.array(z.string())
				.optional()
				.describe("List of work item type UUIDs to filter by type"),
			cycle_ids: z
				.array(z.string())
				.optional()
				.describe("List of cycle UUIDs to filter by cycle"),
			module_ids: z
				.array(z.string())
				.optional()
				.describe("List of module UUIDs to filter by module"),
			is_archived: z
				.boolean()
				.optional()
				.describe("Filter by archived status (true/false)"),
			created_by_ids: z
				.array(z.string())
				.optional()
				.describe("List of user UUIDs to filter by creator"),
			workspace_search: z
				.boolean()
				.optional()
				.describe(
					"When true, search across all projects in the workspace. Only used with filters. Defaults to false.",
				),
			limit: z
				.number()
				.int()
				.optional()
				.describe(
					"Maximum number of results (only used with filters, default 25)",
				),
			cursor: z
				.string()
				.optional()
				.describe(
					"Pagination cursor for getting next set of results (list only)",
				),
			per_page: z
				.number()
				.int()
				.optional()
				.describe("Number of results per page, 1-100 (list only)"),
			expand: z
				.string()
				.optional()
				.describe(
					'Comma-separated list of related fields to expand in response (list only, e.g. "assignees,labels,state")',
				),
			fields: z
				.string()
				.optional()
				.describe(
					"Comma-separated list of fields to include in response (list only)",
				),
			order_by: z
				.string()
				.optional()
				.describe(
					"Field to order results by, prefix with '-' for descending (list only)",
				),
			external_id: z
				.string()
				.optional()
				.describe("External system identifier for filtering (list only)"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name for filtering (list only)"),
		},
		async (params) =>
			toolResultWithUrl("work_item", ctx, async () => {
				const projectId = resolveProjectId(ctx, params);
				const filters = _buildAdvancedSearchFilters({
					assignee_ids: params.assignee_ids,
					state_ids: params.state_ids,
					state_groups: params.state_groups,
					priorities: params.priorities,
					label_ids: params.label_ids,
					type_ids: params.type_ids,
					cycle_ids: params.cycle_ids,
					module_ids: params.module_ids,
					is_archived: params.is_archived,
					created_by_ids: params.created_by_ids,
				});

				if (filters !== null || params.query !== undefined) {
					const body: AdvancedSearchBody = stripNullish({
						query: params.query,
						filters,
						limit: params.limit,
						project_id: projectId,
						workspace_search: params.workspace_search ? true : null,
					}) as AdvancedSearchBody;
					return workItems.advancedSearch(ctx.config, ctx.workspaceSlug, body);
				}

				if (projectId === undefined) {
					throw new Error(
						"project_id is required when no filters are provided",
					);
				}

				const queryParams: WorkItemQueryParams = stripNullish({
					cursor: params.cursor,
					per_page: params.per_page,
					expand: params.expand,
					fields: params.fields,
					order_by: params.order_by,
					external_id: params.external_id,
					external_source: params.external_source,
				}) as WorkItemQueryParams;

				const response = await workItems.list(
					ctx.config,
					ctx.workspaceSlug,
					projectId,
					queryParams,
				);
				return response.results;
			}),
	);

	server.tool(
		"create_work_item",
		"Create a new work item.",
		{
			...projectIdField(ctx),
			name: z.string().describe("Work item name (required)"),
			assignees: z
				.array(z.string())
				.optional()
				.describe("List of user IDs to assign to the work item"),
			labels: z
				.array(z.string())
				.optional()
				.describe("List of label IDs to attach to the work item"),
			type_id: z.string().optional().describe("UUID of the work item type"),
			point: z.number().int().optional().describe("Story point value"),
			description_html: z
				.string()
				.optional()
				.describe("HTML description of the work item"),
			description_stripped: z
				.string()
				.optional()
				.describe("Plain text description (stripped of HTML)"),
			priority: z
				.string()
				.optional()
				.describe("Priority level (urgent, high, medium, low, none)"),
			start_date: z
				.string()
				.optional()
				.describe("Start date (ISO 8601 format)"),
			target_date: z
				.string()
				.optional()
				.describe("Target/end date (ISO 8601 format)"),
			sort_order: z.number().optional().describe("Sort order value"),
			is_draft: z
				.boolean()
				.optional()
				.describe("Whether the work item is a draft"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
			parent: z.string().optional().describe("UUID of the parent work item"),
			state: z.string().optional().describe("UUID of the state"),
			estimate_point: z.string().optional().describe("Estimate point value"),
			type: z.string().optional().describe("Work item type identifier"),
		},
		async (params) =>
			toolResultWithUrl("work_item", ctx, () => {
				const data: CreateWorkItemBody = stripNullish({
					name: params.name,
					assignees: params.assignees,
					labels: params.labels,
					type_id: params.type_id,
					point: params.point,
					description_html: params.description_html,
					description_stripped: params.description_stripped,
					priority: params.priority as PriorityEnum | undefined,
					start_date: params.start_date,
					target_date: params.target_date,
					sort_order: params.sort_order,
					is_draft: params.is_draft,
					external_source: params.external_source,
					external_id: params.external_id,
					parent: params.parent,
					state: params.state,
					estimate_point: params.estimate_point,
					type: params.type,
				}) as CreateWorkItemBody;
				return workItems.create(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					data,
				);
			}),
	);

	server.tool(
		"retrieve_work_item",
		"Retrieve a work item by ID.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			expand: z
				.string()
				.optional()
				.describe(
					'Comma-separated fields to expand (e.g., "assignees,labels,state")',
				),
			fields: z
				.string()
				.optional()
				.describe("Comma-separated fields to include in response"),
			external_id: z
				.string()
				.optional()
				.describe("External system identifier for filtering"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name for filtering"),
			order_by: z
				.string()
				.optional()
				.describe(
					"Field to order results by (typically not used for single item retrieval)",
				),
		},
		async (params) =>
			toolResultWithUrl("work_item", ctx, () =>
				workItems.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.work_item_id,
					stripNullish({
						expand: params.expand,
						fields: params.fields,
						external_id: params.external_id,
						external_source: params.external_source,
						order_by: params.order_by,
					}),
				),
			),
	);

	server.tool(
		"retrieve_work_item_by_identifier",
		"Retrieve a work item by project identifier and issue sequence number.",
		{
			project_identifier: z
				.string()
				.describe('Project identifier string (e.g., "MP" for "My Project")'),
			issue_identifier: z
				.number()
				.int()
				.describe("Issue sequence number (e.g., 1, 2, 3)"),
			expand: z
				.string()
				.optional()
				.describe(
					'Comma-separated fields to expand (e.g., "assignees,labels,state")',
				),
			fields: z
				.string()
				.optional()
				.describe("Comma-separated list of fields to include in response"),
			external_id: z
				.string()
				.optional()
				.describe("External system identifier for filtering"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name for filtering"),
			order_by: z
				.string()
				.optional()
				.describe(
					"Field to order results by (typically not used for single item retrieval)",
				),
		},
		async (params) =>
			toolResultWithUrl("work_item", ctx, () =>
				workItems.retrieveByIdentifier(
					ctx.config,
					ctx.workspaceSlug,
					params.project_identifier,
					params.issue_identifier,
					stripNullish({
						expand: params.expand,
						fields: params.fields,
						external_id: params.external_id,
						external_source: params.external_source,
						order_by: params.order_by,
					}),
				),
			),
	);

	server.tool(
		"update_work_item",
		"Update a work item by ID.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
			name: z.string().optional().describe("Work item name"),
			assignees: z
				.array(z.string())
				.optional()
				.describe("List of user IDs to assign to the work item"),
			labels: z
				.array(z.string())
				.optional()
				.describe("List of label IDs to attach to the work item"),
			type_id: z.string().optional().describe("UUID of the work item type"),
			point: z.number().int().optional().describe("Story point value"),
			description_html: z
				.string()
				.optional()
				.describe("HTML description of the work item"),
			description_stripped: z
				.string()
				.optional()
				.describe("Plain text description (stripped of HTML)"),
			priority: z
				.string()
				.optional()
				.describe("Priority level (urgent, high, medium, low, none)"),
			start_date: z
				.string()
				.optional()
				.describe("Start date (ISO 8601 format)"),
			target_date: z
				.string()
				.optional()
				.describe("Target/end date (ISO 8601 format)"),
			sort_order: z.number().optional().describe("Sort order value"),
			is_draft: z
				.boolean()
				.optional()
				.describe("Whether the work item is a draft"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
			parent: z.string().optional().describe("UUID of the parent work item"),
			state: z.string().optional().describe("UUID of the state"),
			estimate_point: z.string().optional().describe("Estimate point value"),
			type: z.string().optional().describe("Work item type identifier"),
		},
		async (params) =>
			toolResult(() => {
				const data: UpdateWorkItemBody = stripNullish({
					name: params.name,
					assignees: params.assignees,
					labels: params.labels,
					type_id: params.type_id,
					point: params.point,
					description_html: params.description_html,
					description_stripped: params.description_stripped,
					priority: params.priority as PriorityEnum | undefined,
					start_date: params.start_date,
					target_date: params.target_date,
					sort_order: params.sort_order,
					is_draft: params.is_draft,
					external_source: params.external_source,
					external_id: params.external_id,
					parent: params.parent,
					state: params.state,
					estimate_point: params.estimate_point,
					type: params.type,
				});
				return workItems.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.work_item_id,
					data,
				);
			}),
	);

	server.tool(
		"delete_work_item",
		"Delete a work item by ID.",
		{
			...projectIdField(ctx),
			work_item_id: z.string().describe("UUID of the work item"),
		},
		async (params) =>
			toolResult(() =>
				workItems.delete(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, params),
					params.work_item_id,
				),
			),
	);

	server.tool(
		"search_work_items",
		"Search work items across a workspace.",
		{
			query: z
				.string()
				.describe(
					"This is a free-form text search and will be used to search the work items by name, description etc.",
				),
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
			external_id: z
				.string()
				.optional()
				.describe("External system identifier for filtering"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name for filtering"),
			order_by: z
				.string()
				.optional()
				.describe(
					"Field to order results by. Prefix with '-' for descending order",
				),
		},
		async (params) =>
			toolResultWithUrl("work_item", ctx, () =>
				workItems.search(
					ctx.config,
					ctx.workspaceSlug,
					params.query,
					stripNullish({
						expand: params.expand,
						fields: params.fields,
						external_id: params.external_id,
						external_source: params.external_source,
						order_by: params.order_by,
					}),
				),
			),
	);
}
