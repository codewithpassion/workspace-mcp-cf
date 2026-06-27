import type { PaginatedResponse, UnknownObject } from "./common";

export interface IntakeWorkItem {
	id?: string | null;
	issue_detail?: UnknownObject | null;
	inbox?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	deleted_at?: string | null;
	status?: number | string | null;
	snoozed_till?: string | null;
	source?: string | null;
	source_email?: string | null;
	external_source?: string | null;
	external_id?: string | null;
	extra?: unknown;
	created_by?: string | null;
	updated_by?: string | null;
	project?: string | UnknownObject | null;
	workspace?: string | null;
	intake?: string | null;
	issue?: string | null;
	duplicate_to?: string | null;
	[key: string]: unknown;
}

export type CreateIntakeWorkItemBody = UnknownObject;
export type UpdateIntakeWorkItemBody = UnknownObject;

export type PaginatedIntakeWorkItemResponse = PaginatedResponse<IntakeWorkItem>;
