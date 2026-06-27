import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	PaginatedQueryParams,
	RetrieveQueryParams,
} from "../types/common";
import type { Epic, PaginatedEpicResponse } from "../types/epics";
import type {
	CreateWorkItemBody,
	UpdateWorkItemBody,
	WorkItem,
} from "../types/work_items";

export const epics = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: PaginatedQueryParams | null,
	): Promise<PaginatedEpicResponse> {
		return planeFetch<PaginatedEpicResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/epics`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		epicId: string,
		params?: RetrieveQueryParams | null,
	): Promise<Epic> {
		return planeFetch<Epic>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/epics/${epicId}`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	// Epic create/update tools delegate to the work-items endpoint with type_id
	// set to the epic work item type (mirrors the Python tool behavior).
	createWorkItem(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateWorkItemBody,
	): Promise<WorkItem> {
		return planeFetch<WorkItem>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-items`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	updateWorkItem(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		data: UpdateWorkItemBody,
	): Promise<WorkItem> {
		return planeFetch<WorkItem>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	deleteWorkItem(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}`,
		);
	},
};
