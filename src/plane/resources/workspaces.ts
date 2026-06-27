import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type { UserLite } from "../types/users";
import type { WorkspaceFeature } from "../types/workspaces";

export const workspaces = {
	getMembers(config: PlaneConfig, workspaceSlug: string): Promise<UserLite[]> {
		return planeFetch<UserLite[]>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/members`,
		);
	},

	getFeatures(
		config: PlaneConfig,
		workspaceSlug: string,
	): Promise<WorkspaceFeature> {
		return planeFetch<WorkspaceFeature>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/features`,
		);
	},

	updateFeatures(
		config: PlaneConfig,
		workspaceSlug: string,
		data: WorkspaceFeature,
	): Promise<WorkspaceFeature> {
		return planeFetch<WorkspaceFeature>(
			config,
			"PATCH",
			`workspaces/${workspaceSlug}/features`,
			{ body: stripNullish(data) },
		);
	},
};
