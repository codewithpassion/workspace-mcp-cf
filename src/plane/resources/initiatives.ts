import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type {
	CreateInitiativeBody,
	Initiative,
	PaginatedInitiativeResponse,
	UpdateInitiativeBody,
} from "../types/initiatives";

export const initiatives = {
	list(
		config: PlaneConfig,
		workspaceSlug: string,
		params?: Record<string, unknown> | null,
	): Promise<PaginatedInitiativeResponse> {
		return planeFetch<PaginatedInitiativeResponse>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/initiatives`,
			{ params },
		);
	},

	create(
		config: PlaneConfig,
		workspaceSlug: string,
		data: CreateInitiativeBody,
	): Promise<Initiative> {
		return planeFetch<Initiative>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/initiatives`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	retrieve(
		config: PlaneConfig,
		workspaceSlug: string,
		initiativeId: string,
	): Promise<Initiative> {
		return planeFetch<Initiative>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/initiatives/${initiativeId}`,
		);
	},

	update(
		config: PlaneConfig,
		workspaceSlug: string,
		initiativeId: string,
		data: UpdateInitiativeBody,
	): Promise<Initiative> {
		return planeFetch<Initiative>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/initiatives/${initiativeId}`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	delete(
		config: PlaneConfig,
		workspaceSlug: string,
		initiativeId: string,
	): Promise<void> {
		return planeFetch<void>(
			config,
			"DELETE",
			`workspaces/${workspaceSlug}/initiatives/${initiativeId}`,
		);
	},
};
