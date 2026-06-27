import type { PaginatedResponse, PriorityEnum } from "./common";

export interface Epic {
	id?: string | null;
	deleted_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	point?: number | null;
	name: string;
	description?: unknown;
	description_html?: string | null;
	description_stripped?: string | null;
	description_binary?: string | null;
	priority?: PriorityEnum | null;
	start_date?: string | null;
	target_date?: string | null;
	sequence_id?: number | null;
	sort_order?: number | null;
	completed_at?: string | null;
	archived_at?: string | null;
	is_draft?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
	created_by?: string | null;
	updated_by?: string | null;
	project?: string;
	workspace?: string;
	parent?: string | null;
	state?: string | null;
	estimate_point?: string | null;
	type?: string | null;
	assignees?: string[] | null;
	labels?: string[] | null;
	[key: string]: unknown;
}

export type PaginatedEpicResponse = PaginatedResponse<Epic>;
