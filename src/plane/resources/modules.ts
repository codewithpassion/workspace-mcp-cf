import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateModuleBody,
	Module,
	PaginatedArchivedModuleResponse,
	PaginatedModuleResponse,
	PaginatedModuleWorkItemResponse,
	UpdateModuleBody,
} from "../types/modules";

export const modules = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedModuleResponse> {
		return planeFetch<PaginatedModuleResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateModuleBody,
	): Promise<Module> {
		return planeFetch<Module>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		moduleId: string,
	): Promise<Module> {
		return planeFetch<Module>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		moduleId: string,
		data: UpdateModuleBody,
	): Promise<Module> {
		return planeFetch<Module>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		moduleId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}`,
		);
	},

	listArchived(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedArchivedModuleResponse> {
		return planeFetch<PaginatedArchivedModuleResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/archived-modules`,
			{ params },
		);
	},

	addWorkItems(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		moduleId: string,
		issueIds: string[],
	): Promise<void> {
		return planeFetch<void>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/module-issues`,
			{ body: { issues: issueIds } },
		);
	},

	removeWorkItem(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		moduleId: string,
		workItemId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/module-issues/${workItemId}`,
		);
	},

	listWorkItems(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		moduleId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedModuleWorkItemResponse> {
		return planeFetch<PaginatedModuleWorkItemResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/module-issues`,
			{ params },
		);
	},

	archive(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		moduleId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/archive`,
			{ body: {} },
		);
	},

	unarchive(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		moduleId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/archived-modules/${moduleId}/unarchive`,
		);
	},
};
