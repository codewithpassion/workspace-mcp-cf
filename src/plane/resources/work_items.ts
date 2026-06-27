import { type PlaneConfig, planeFetch } from "../client";
import type {
	PaginatedQueryParams,
	RetrieveQueryParams,
	WorkItemQueryParams,
} from "../types/common";
import type {
	PaginatedWorkItemActivityResponse,
	WorkItemActivity,
} from "../types/work_item_activities";
import type {
	CreateWorkItemCommentBody,
	PaginatedWorkItemCommentResponse,
	UpdateWorkItemCommentBody,
	WorkItemComment,
} from "../types/work_item_comments";
import type {
	CreateWorkItemLinkBody,
	PaginatedWorkItemLinkResponse,
	UpdateWorkItemLinkBody,
	WorkItemLink,
} from "../types/work_item_links";
import type {
	CreateWorkItemRelationBody,
	RemoveWorkItemRelationBody,
	WorkItemRelationResponse,
} from "../types/work_item_relations";
import type {
	AdvancedSearchBody,
	AdvancedSearchResult,
	CreateWorkItemBody,
	PaginatedWorkItemResponse,
	UpdateWorkItemBody,
	WorkItem,
	WorkItemDetail,
	WorkItemSearch,
} from "../types/work_items";

function base(workspaceSlug: string, projectId: string): string {
	return `workspaces/${workspaceSlug}/projects/${projectId}/work-items`;
}

export const workItems = {
	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateWorkItemBody,
	): Promise<WorkItem> {
		return planeFetch<WorkItem>(
			config,
			"POST",
			base(workspaceSlug, projectId),
			{
				body: data,
			},
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		params?: RetrieveQueryParams | null,
	): Promise<WorkItemDetail> {
		return planeFetch<WorkItemDetail>(
			config,
			"GET",
			`${base(workspaceSlug, projectId)}/${workItemId}`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	retrieveByIdentifier(
		config: PlaneConfig,
		workspaceSlug: string,
		projectIdentifier: string,
		issueIdentifier: number,
		params?: RetrieveQueryParams | null,
	): Promise<WorkItemDetail> {
		return planeFetch<WorkItemDetail>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/work-items/${projectIdentifier}-${issueIdentifier}`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		data: UpdateWorkItemBody,
	): Promise<WorkItem> {
		return planeFetch<WorkItem>(
			config,
			"PATCH",
			`${base(workspaceSlug, projectId)}/${workItemId}`,
			{ body: data },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`${base(workspaceSlug, projectId)}/${workItemId}`,
		);
	},

	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: WorkItemQueryParams | null,
	): Promise<PaginatedWorkItemResponse> {
		return planeFetch<PaginatedWorkItemResponse>(
			config,
			"GET",
			base(workspaceSlug, projectId),
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	search(
		config: PlaneConfig,
		workspaceSlug: string,
		query: string,
		params?: RetrieveQueryParams | null,
	): Promise<WorkItemSearch> {
		const search: Record<string, unknown> = { q: query };
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined && v !== null) search[k] = v;
			}
		}
		return planeFetch<WorkItemSearch>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/work-items/search`,
			{ params: search },
		);
	},

	advancedSearch(
		config: PlaneConfig,
		workspaceSlug: string,
		data: AdvancedSearchBody,
	): Promise<AdvancedSearchResult[]> {
		return planeFetch<AdvancedSearchResult[]>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/work-items/advanced-search`,
			{ body: data },
		);
	},

	// Activities
	listActivities(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		params?: PaginatedQueryParams | Record<string, unknown> | null,
	): Promise<PaginatedWorkItemActivityResponse> {
		return planeFetch<PaginatedWorkItemActivityResponse>(
			config,
			"GET",
			`${base(workspaceSlug, projectId)}/${workItemId}/activities`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	retrieveActivity(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		activityId: string,
	): Promise<WorkItemActivity> {
		return planeFetch<WorkItemActivity>(
			config,
			"GET",
			`${base(workspaceSlug, projectId)}/${workItemId}/activities/${activityId}`,
		);
	},

	// Comments
	listComments(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		params?: PaginatedQueryParams | Record<string, unknown> | null,
	): Promise<PaginatedWorkItemCommentResponse> {
		return planeFetch<PaginatedWorkItemCommentResponse>(
			config,
			"GET",
			`${base(workspaceSlug, projectId)}/${workItemId}/comments`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	retrieveComment(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		commentId: string,
	): Promise<WorkItemComment> {
		return planeFetch<WorkItemComment>(
			config,
			"GET",
			`${base(workspaceSlug, projectId)}/${workItemId}/comments/${commentId}`,
		);
	},

	createComment(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		data: CreateWorkItemCommentBody,
	): Promise<WorkItemComment> {
		return planeFetch<WorkItemComment>(
			config,
			"POST",
			`${base(workspaceSlug, projectId)}/${workItemId}/comments`,
			{ body: data },
		);
	},

	updateComment(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		commentId: string,
		data: UpdateWorkItemCommentBody,
	): Promise<WorkItemComment> {
		return planeFetch<WorkItemComment>(
			config,
			"PATCH",
			`${base(workspaceSlug, projectId)}/${workItemId}/comments/${commentId}`,
			{ body: data },
		);
	},

	deleteComment(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		commentId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`${base(workspaceSlug, projectId)}/${workItemId}/comments/${commentId}`,
		);
	},

	// Links
	listLinks(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		params?: PaginatedQueryParams | Record<string, unknown> | null,
	): Promise<PaginatedWorkItemLinkResponse> {
		return planeFetch<PaginatedWorkItemLinkResponse>(
			config,
			"GET",
			`${base(workspaceSlug, projectId)}/${workItemId}/links`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	retrieveLink(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		linkId: string,
	): Promise<WorkItemLink> {
		return planeFetch<WorkItemLink>(
			config,
			"GET",
			`${base(workspaceSlug, projectId)}/${workItemId}/links/${linkId}`,
		);
	},

	createLink(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		data: CreateWorkItemLinkBody,
	): Promise<WorkItemLink> {
		return planeFetch<WorkItemLink>(
			config,
			"POST",
			`${base(workspaceSlug, projectId)}/${workItemId}/links`,
			{ body: data },
		);
	},

	updateLink(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		linkId: string,
		data: UpdateWorkItemLinkBody,
	): Promise<WorkItemLink> {
		return planeFetch<WorkItemLink>(
			config,
			"PATCH",
			`${base(workspaceSlug, projectId)}/${workItemId}/links/${linkId}`,
			{ body: data },
		);
	},

	deleteLink(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		linkId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`${base(workspaceSlug, projectId)}/${workItemId}/links/${linkId}`,
		);
	},

	// Relations
	listRelations(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
	): Promise<WorkItemRelationResponse> {
		return planeFetch<WorkItemRelationResponse>(
			config,
			"GET",
			`${base(workspaceSlug, projectId)}/${workItemId}/relations`,
		);
	},

	createRelation(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		data: CreateWorkItemRelationBody,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"POST",
			`${base(workspaceSlug, projectId)}/${workItemId}/relations`,
			{ body: data },
		);
	},

	removeRelation(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		data: RemoveWorkItemRelationBody,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"POST",
			`${base(workspaceSlug, projectId)}/${workItemId}/relations/remove`,
			{ body: data },
		);
	},
};
