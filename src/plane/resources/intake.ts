import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateIntakeWorkItemBody,
	IntakeWorkItem,
	PaginatedIntakeWorkItemResponse,
	UpdateIntakeWorkItemBody,
} from "../types/intake";

export const intake = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedIntakeWorkItemResponse> {
		return planeFetch<PaginatedIntakeWorkItemResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/intake-issues`,
			{ params },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		params?: Record<string, unknown> | null,
	): Promise<IntakeWorkItem> {
		return planeFetch<IntakeWorkItem>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/intake-issues/${workItemId}`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateIntakeWorkItemBody,
	): Promise<IntakeWorkItem> {
		return planeFetch<IntakeWorkItem>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/intake-issues`,
			{ body: stripNullish(data as Record<string, unknown>) },
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		workItemId: string,
		data: UpdateIntakeWorkItemBody,
	): Promise<IntakeWorkItem> {
		return planeFetch<IntakeWorkItem>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/intake-issues/${workItemId}`,
			{ body: stripNullish(data as Record<string, unknown>) },
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
			`workspaces/${workspaceSlug}/projects/${projectId}/intake-issues/${workItemId}`,
		);
	},
};
