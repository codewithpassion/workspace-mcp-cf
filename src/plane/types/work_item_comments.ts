import type { AccessEnum, PaginatedResponse } from "./common";

export interface WorkItemComment {
	id?: string | null;
	is_member?: boolean | null;
	created_at?: string | null;
	updated_at?: string | null;
	deleted_at?: string | null;
	comment_stripped?: string | null;
	comment_html?: string | null;
	attachments?: string[] | null;
	access?: AccessEnum | null;
	external_source?: string | null;
	external_id?: string | null;
	edited_at?: string | null;
	created_by?: string | null;
	updated_by?: string | null;
	project?: string | null;
	workspace?: string | null;
	issue?: string | null;
	actor?: string | null;
	[key: string]: unknown;
}

export interface CreateWorkItemCommentBody {
	comment_json?: unknown;
	comment_html?: string | null;
	access?: AccessEnum | null;
	external_source?: string | null;
	external_id?: string | null;
}

export type UpdateWorkItemCommentBody = CreateWorkItemCommentBody;

export type PaginatedWorkItemCommentResponse =
	PaginatedResponse<WorkItemComment>;
