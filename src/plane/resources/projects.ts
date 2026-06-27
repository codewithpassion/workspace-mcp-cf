import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type { PaginatedQueryParams } from "../types/common";
import type {
	CreateProjectBody,
	PaginatedProjectResponse,
	Project,
	ProjectFeature,
	ProjectWorklogSummary,
	UpdateProjectBody,
} from "../types/projects";
import type { UserLite } from "../types/users";

export const projects = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		params?: PaginatedQueryParams | null,
	): Promise<PaginatedProjectResponse> {
		return planeFetch<PaginatedProjectResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		data: CreateProjectBody,
	): Promise<Project> {
		return planeFetch<Project>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
	): Promise<Project> {
		return planeFetch<Project>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: UpdateProjectBody,
	): Promise<Project> {
		return planeFetch<Project>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}`,
		);
	},

	getWorklogSummary(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
	): Promise<ProjectWorklogSummary[]> {
		return planeFetch<ProjectWorklogSummary[]>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/total-worklogs`,
		);
	},

	getMembers(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<UserLite[]> {
		return planeFetch<UserLite[]>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/members`,
			{ params },
		);
	},

	getFeatures(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
	): Promise<ProjectFeature> {
		return planeFetch<ProjectFeature>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/features`,
		);
	},

	updateFeatures(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: ProjectFeature,
	): Promise<ProjectFeature> {
		return planeFetch<ProjectFeature>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/features`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},
};
