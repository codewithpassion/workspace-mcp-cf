import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateWorkItemPropertyBody,
	UpdateWorkItemPropertyBody,
	WorkItemProperty,
} from "../types/work_item_properties";

export const workItemProperties = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		typeId: string,
		params?: Record<string, unknown> | null,
	): Promise<WorkItemProperty[]> {
		return planeFetch<WorkItemProperty[]>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types/${typeId}/work-item-properties`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		typeId: string,
		data: CreateWorkItemPropertyBody,
	): Promise<WorkItemProperty> {
		return planeFetch<WorkItemProperty>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types/${typeId}/work-item-properties`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		typeId: string,
		workItemPropertyId: string,
	): Promise<WorkItemProperty> {
		return planeFetch<WorkItemProperty>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types/${typeId}/work-item-properties/${workItemPropertyId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		typeId: string,
		workItemPropertyId: string,
		data: UpdateWorkItemPropertyBody,
	): Promise<WorkItemProperty> {
		return planeFetch<WorkItemProperty>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types/${typeId}/work-item-properties/${workItemPropertyId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		typeId: string,
		workItemPropertyId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-item-types/${typeId}/work-item-properties/${workItemPropertyId}`,
		);
	},
};
