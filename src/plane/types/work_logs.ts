export interface WorkItemWorkLog {
	id?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	description?: string | null;
	duration?: number | null;
	created_by?: string | null;
	updated_by?: string | null;
	project_id?: string | null;
	workspace_id?: string | null;
	logged_by?: string | null;
	[key: string]: unknown;
}

export interface CreateWorkLogBody {
	duration?: number | null;
	description?: string | null;
}

export interface UpdateWorkLogBody {
	duration?: number | null;
	description?: string | null;
}
