export type AccessEnum = "INTERNAL" | "EXTERNAL";
export type StateGroupEnum =
	| "backlog"
	| "unstarted"
	| "started"
	| "completed"
	| "cancelled"
	| "triage";
export type WorkItemRelationTypeEnum =
	| "blocking"
	| "blocked_by"
	| "duplicate"
	| "relates_to"
	| "start_before"
	| "start_after"
	| "finish_before"
	| "finish_after";
export type ModuleStatusEnum =
	| "backlog"
	| "planned"
	| "in-progress"
	| "paused"
	| "completed"
	| "cancelled";
export type PriorityEnum = "urgent" | "high" | "medium" | "low" | "none";
export type PropertyTypeEnum =
	| "TEXT"
	| "DATETIME"
	| "DECIMAL"
	| "BOOLEAN"
	| "OPTION"
	| "RELATION"
	| "URL"
	| "EMAIL"
	| "FILE";
export type RelationTypeEnum = "ISSUE" | "USER";
export type InitiativeStateEnum =
	| "DRAFT"
	| "PLANNED"
	| "ACTIVE"
	| "COMPLETED"
	| "CLOSED";

export interface PaginatedQueryParams {
	cursor?: string | null;
	per_page?: number | null;
	expand?: string | null;
	fields?: string | null;
	external_id?: string | null;
	external_source?: string | null;
	order_by?: string | null;
}

export interface WorkItemQueryParams extends PaginatedQueryParams {
	pql?: string | null;
}

export interface RetrieveQueryParams {
	expand?: string | null;
	fields?: string | null;
	external_id?: string | null;
	external_source?: string | null;
	order_by?: string | null;
}

export interface PaginatedResponse<T> {
	cursor?: string | null;
	prev_cursor?: string | null;
	next_cursor?: string | null;
	total_count?: number;
	total_pages?: number;
	count?: number;
	results: T[];
	[key: string]: unknown;
}

export type UnknownObject = Record<string, unknown>;
