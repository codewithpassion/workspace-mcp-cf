export interface WorkItemType {
	id?: string | null;
	deleted_at?: string | null;
	project_ids?: string[] | null;
	created_at?: string | null;
	updated_at?: string | null;
	name: string;
	description?: string | null;
	logo_props?: unknown;
	is_epic?: boolean | null;
	is_default?: boolean | null;
	is_active?: boolean | null;
	level?: number | null;
	external_source?: string | null;
	external_id?: string | null;
	created_by?: string | null;
	updated_by?: string | null;
	workspace?: string | null;
	[key: string]: unknown;
}

export interface CreateWorkItemTypeBody {
	project_ids?: string[] | null;
	name: string;
	description?: string | null;
	is_epic?: boolean | null;
	is_active?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
}

export interface UpdateWorkItemTypeBody {
	project_ids?: string[] | null;
	name?: string | null;
	description?: string | null;
	is_epic?: boolean | null;
	is_active?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
}
