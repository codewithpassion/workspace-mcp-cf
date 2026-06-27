import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateCycleBody,
	Cycle,
	PaginatedArchivedCycleResponse,
	PaginatedCycleResponse,
	PaginatedCycleWorkItemResponse,
	TransferCycleWorkItemsRequest,
	UpdateCycleBody,
} from "../types/cycles";

export const cycles = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedCycleResponse> {
		return planeFetch<PaginatedCycleResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateCycleBody,
	): Promise<Cycle> {
		return planeFetch<Cycle>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
	): Promise<Cycle> {
		return planeFetch<Cycle>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
		data: UpdateCycleBody,
	): Promise<Cycle> {
		return planeFetch<Cycle>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}`,
		);
	},

	listArchived(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedArchivedCycleResponse> {
		return planeFetch<PaginatedArchivedCycleResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/archived-cycles`,
			{ params },
		);
	},

	addWorkItems(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
		issueIds: string[],
	): Promise<void> {
		return planeFetch<void>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}/cycle-issues`,
			{ body: { issues: issueIds } },
		);
	},

	removeWorkItem(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
		workItemId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}/cycle-issues/${workItemId}`,
		);
	},

	listWorkItems(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedCycleWorkItemResponse> {
		return planeFetch<PaginatedCycleWorkItemResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}/cycle-issues`,
			{ params },
		);
	},

	transferWorkItems(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
		data: TransferCycleWorkItemsRequest,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}/transfer-issues`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	archive(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
	): Promise<unknown> {
		return planeFetch<unknown>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}/archive`,
			{ body: {} },
		);
	},

	unarchive(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		cycleId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/archived-cycles/${cycleId}/unarchive`,
		);
	},
};
