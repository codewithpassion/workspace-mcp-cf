import type { PaginatedResponse } from "./common";

export interface WorkItemActivity {
	id?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	deleted_at?: string | null;
	verb?: string | null;
	field?: string | null;
	old_value?: string | null;
	new_value?: string | null;
	comment?: string | null;
	attachments?: string[] | null;
	old_identifier?: string | null;
	new_identifier?: string | null;
	epoch?: number | null;
	project: string;
	workspace: string;
	issue?: string | null;
	issue_comment?: string | null;
	actor?: string | null;
	[key: string]: unknown;
}

export type PaginatedWorkItemActivityResponse =
	PaginatedResponse<WorkItemActivity>;
