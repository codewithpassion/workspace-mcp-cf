import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateWorkItemTypeBody,
	UpdateWorkItemTypeBody,
	WorkItemType,
} from "../types/work_item_types";

export const workItemTypes = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<WorkItemType[]> {
		return planeFetch<WorkItemType[]>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateWorkItemTypeBody,
	): Promise<WorkItemType> {
		return planeFetch<WorkItemType>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemTypeId: string,
	): Promise<WorkItemType> {
		return planeFetch<WorkItemType>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types/${workItemTypeId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemTypeId: string,
		data: UpdateWorkItemTypeBody,
	): Promise<WorkItemType> {
		return planeFetch<WorkItemType>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types/${workItemTypeId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemTypeId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types/${workItemTypeId}`,
		);
	},
};
