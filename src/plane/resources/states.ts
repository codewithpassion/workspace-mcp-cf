import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateStateBody,
	PaginatedStateResponse,
	State,
	UpdateStateBody,
} from "../types/states";

export const states = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedStateResponse> {
		return planeFetch<PaginatedStateResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/states`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreateStateBody,
	): Promise<State> {
		return planeFetch<State>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/states`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		stateId: string,
	): Promise<State> {
		return planeFetch<State>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/states/${stateId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		stateId: string,
		data: UpdateStateBody,
	): Promise<State> {
		return planeFetch<State>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/projects/${projectId}/states/${stateId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		stateId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/projects/${projectId}/states/${stateId}`,
		);
	},
};
