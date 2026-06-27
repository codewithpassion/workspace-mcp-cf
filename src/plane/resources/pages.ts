import { type PlaneConfig, planeFetch } from "../client";
import { stripNullish } from "../tools/_helpers";
import type { RetrieveQueryParams } from "../types/common";
import type { CreatePageBody, Page } from "../types/pages";

export const pages = {
	retrieveWorkspacePage(
		config: PlaneConfig,
		workspaceSlug: string,
		pageId: string,
		params?: RetrieveQueryParams | null,
	): Promise<Page> {
		return planeFetch<Page>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/pages/${pageId}`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	retrieveProjectPage(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		pageId: string,
		params?: RetrieveQueryParams | null,
	): Promise<Page> {
		return planeFetch<Page>(
			config,
			"GET",
			`workspaces/${workspaceSlug}/projects/${projectId}/pages/${pageId}`,
			{ params: params as Record<string, unknown> | null | undefined },
		);
	},

	createWorkspacePage(
		config: PlaneConfig,
		workspaceSlug: string,
		data: CreatePageBody,
	): Promise<Page> {
		return planeFetch<Page>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/pages`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},

	createProjectPage(
		config: PlaneConfig,
		workspaceSlug: string,
		projectId: string,
		data: CreatePageBody,
	): Promise<Page> {
		return planeFetch<Page>(
			config,
			"POST",
			`workspaces/${workspaceSlug}/projects/${projectId}/pages`,
			{ body: stripNullish(data as unknown as Record<string, unknown>) },
		);
	},
};
