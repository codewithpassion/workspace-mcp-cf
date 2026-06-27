import type { PaginatedResponse } from "./common";

export interface Label {
	id?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	deleted_at?: string | null;
	name: string;
	description?: string | null;
	color?: string | null;
	sort_order?: number | null;
	external_source?: string | null;
	external_id?: string | null;
	created_by?: string | null;
	updated_by?: string | null;
	workspace?: string | null;
	project?: string | null;
	parent?: string | null;
	[key: string]: unknown;
}

export interface CreateLabelBody {
	name: string;
	color?: string | null;
	description?: string | null;
	external_source?: string | null;
	external_id?: string | null;
	parent?: string | null;
	sort_order?: number | null;
}

export interface UpdateLabelBody {
	name?: string | null;
	color?: string | null;
	description?: string | null;
	external_source?: string | null;
	external_id?: string | null;
	parent?: string | null;
	sort_order?: number | null;
}

export type PaginatedLabelResponse = PaginatedResponse<Label>;
