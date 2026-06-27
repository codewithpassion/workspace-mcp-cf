import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateMilestoneBody,
	Milestone,
	PaginatedMilestoneResponse,
	PaginatedMilestoneWorkItemResponse,
	UpdateMilestoneBody,
} from "../types/milestones";

export const milestones = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedMilestoneResponse> {
		return planeFetch<PaginatedMilestoneResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/milestones`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateMilestoneBody,
	): Promise<Milestone> {
		return planeFetch<Milestone>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/milestones`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		milestoneId: string,
	): Promise<Milestone> {
		return planeFetch<Milestone>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/milestones/${milestoneId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		milestoneId: string,
		data: UpdateMilestoneBody,
	): Promise<Milestone> {
		return planeFetch<Milestone>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/milestones/${milestoneId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		milestoneId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/milestones/${milestoneId}`,
		);
	},

	addWorkItems(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		milestoneId: string,
		issueIds: string[],
	): Promise<void> {
		return planeFetch<void>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/milestones/${milestoneId}/work-items`,
			{ body: { issues: issueIds } },
		);
	},

	removeWorkItems(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		milestoneId: string,
		issueIds: string[],
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/milestones/${milestoneId}/work-items`,
			{ body: { issues: issueIds } },
		);
	},

	listWorkItems(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		milestoneId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedMilestoneWorkItemResponse> {
		return planeFetch<PaginatedMilestoneWorkItemResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/milestones/${milestoneId}/work-items`,
			{ params },
		);
	},
};
