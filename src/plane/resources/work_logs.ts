import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateWorkLogBody,
	UpdateWorkLogBody,
	WorkItemWorkLog,
} from "../types/work_logs";

export const workLogs = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		params?: Record<string, unknown> | null,
	): Promise<WorkItemWorkLog[]> {
		return planeFetch<WorkItemWorkLog[]>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/worklogs`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		data: CreateWorkLogBody,
	): Promise<WorkItemWorkLog> {
		return planeFetch<WorkItemWorkLog>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/worklogs`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		workLogId: string,
		data: UpdateWorkLogBody,
	): Promise<WorkItemWorkLog> {
		return planeFetch<WorkItemWorkLog>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/worklogs/${workLogId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		workLogId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/worklogs/${workLogId}`,
		);
	},
};
