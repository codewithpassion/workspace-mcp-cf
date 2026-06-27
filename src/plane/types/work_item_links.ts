import type { PaginatedResponse } from "./common";

export interface WorkItemLink {
	id?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	deleted_at?: string | null;
	title?: string | null;
	url: string;
	metadata?: unknown;
	created_by?: string | null;
	updated_by?: string | null;
	project?: string | null;
	workspace?: string | null;
	issue?: string | null;
	[key: string]: unknown;
}

export interface CreateWorkItemLinkBody {
	url: string;
}

export interface UpdateWorkItemLinkBody {
	url?: string | null;
}

export type PaginatedWorkItemLinkResponse = PaginatedResponse<WorkItemLink>;
