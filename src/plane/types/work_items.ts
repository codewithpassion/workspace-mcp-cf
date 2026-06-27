import type { PaginatedResponse, PriorityEnum } from "./common";
import type { UserLite } from "./users";

export interface StateLite {
	id?: string | null;
	name?: string | null;
	color?: string | null;
	group?: string | null;
	[key: string]: unknown;
}

export interface Label {
	id?: string | null;
	name?: string | null;
	color?: string | null;
	[key: string]: unknown;
}

export interface WorkItem {
	id?: string | null;
	type_id?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	deleted_at?: string | null;
	point?: number | null;
	name: string;
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
	project?: string | null;
	workspace?: string | null;
	parent?: string | null;
	state?: string | StateLite | null;
	estimate_point?: string | null;
	type?: string | null;
	[key: string]: unknown;
}

export interface WorkItemDetail extends WorkItem {
	assignees: UserLite[];
	labels: Label[];
}

export interface CreateWorkItemBody {
	name: string;
	assignees?: string[] | null;
	labels?: string[] | null;
	type_id?: string | null;
	point?: number | null;
	description_html?: string | null;
	description_stripped?: string | null;
	priority?: PriorityEnum | null;
	start_date?: string | null;
	target_date?: string | null;
	sort_order?: number | null;
	is_draft?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
	parent?: string | null;
	state?: string | null;
	estimate_point?: string | null;
	type?: string | null;
}

export type UpdateWorkItemBody = Partial<CreateWorkItemBody>;

export interface WorkItemSearchItem {
	id: string;
	name: string;
	sequence_id: string;
	project__identifier: string;
	project_id: string;
	workspace__slug: string;
	[key: string]: unknown;
}

export interface WorkItemSearch {
	issues: WorkItemSearchItem[];
	[key: string]: unknown;
}

export interface AdvancedSearchBody {
	query?: string | null;
	filters?: Record<string, unknown> | null;
	limit?: number | null;
	project_id?: string | null;
	workspace_search?: boolean | null;
}

export interface AdvancedSearchResult {
	id: string;
	name: string;
	sequence_id: number;
	project_identifier: string;
	project_id: string;
	workspace_id: string;
	type_id?: string | null;
	state_id?: string | null;
	priority?: string | null;
	target_date?: string | null;
	start_date?: string | null;
	[key: string]: unknown;
}

export type PaginatedWorkItemResponse = PaginatedResponse<WorkItem>;
