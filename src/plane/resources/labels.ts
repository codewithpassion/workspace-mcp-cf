import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateLabelBody,
	Label,
	PaginatedLabelResponse,
	UpdateLabelBody,
} from "../types/labels";

export const labels = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedLabelResponse> {
		return planeFetch<PaginatedLabelResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/labels`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateLabelBody,
	): Promise<Label> {
		return planeFetch<Label>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/labels`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		labelId: string,
	): Promise<Label> {
		return planeFetch<Label>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/labels/${labelId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		labelId: string,
		data: UpdateLabelBody,
	): Promise<Label> {
		return planeFetch<Label>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/labels/${labelId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		labelId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/labels/${labelId}`,
		);
	},
};
