import type { PaginatedResponse } from "./common";

export interface Project {
	id?: string | null;
	name: string;
	identifier: string;
	description?: string | null;
	[key: string]: unknown;
}

export interface CreateProjectBody {
	name: string;
	identifier: string;
	description?: string | null;
	project_lead?: string | null;
	default_assignee?: string | null;
	icon_prop?: unknown;
	emoji?: string | null;
	cover_image?: string | null;
	module_view?: boolean | null;
	cycle_view?: boolean | null;
	issue_views_view?: boolean | null;
	page_view?: boolean | null;
	intake_view?: boolean | null;
	guest_view_all_features?: boolean | null;
	archive_in?: number | null;
	close_in?: number | null;
	timezone?: string | null;
	logo_props?: unknown;
	external_source?: string | null;
	external_id?: string | null;
	is_issue_type_enabled?: boolean | null;
}

export interface UpdateProjectBody {
	name?: string | null;
	description?: string | null;
	project_lead?: string | null;
	default_assignee?: string | null;
	identifier?: string | null;
	icon_prop?: unknown;
	emoji?: string | null;
	cover_image?: string | null;
	module_view?: boolean | null;
	cycle_view?: boolean | null;
	issue_views_view?: boolean | null;
	page_view?: boolean | null;
	intake_view?: boolean | null;
	guest_view_all_features?: boolean | null;
	archive_in?: number | null;
	close_in?: number | null;
	timezone?: string | null;
	logo_props?: unknown;
	external_source?: string | null;
	external_id?: string | null;
	is_issue_type_enabled?: boolean | null;
	is_time_tracking_enabled?: boolean | null;
	default_state?: string | null;
	estimate?: string | null;
}

export interface ProjectWorklogSummary {
	issue_id: string;
	duration: number;
	[key: string]: unknown;
}

export interface ProjectFeature {
	epics?: boolean | null;
	modules?: boolean | null;
	cycles?: boolean | null;
	views?: boolean | null;
	pages?: boolean | null;
	intakes?: boolean | null;
	work_item_types?: boolean | null;
	[key: string]: unknown;
}

export type PaginatedProjectResponse = PaginatedResponse<Project>;
