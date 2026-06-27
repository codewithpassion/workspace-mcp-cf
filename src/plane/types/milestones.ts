import type { PaginatedResponse } from "./common";

export interface Milestone {
	id?: string | null;
	title: string;
	target_date?: string | null;
	external_source?: string | null;
	external_id?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	[key: string]: unknown;
}

export interface MilestoneWorkItem {
	id?: string | null;
	issue?: string | null;
	milestone?: string | null;
	[key: string]: unknown;
}

export interface CreateMilestoneBody {
	title: string;
	target_date?: string | null;
	external_source?: string | null;
	external_id?: string | null;
}

export interface UpdateMilestoneBody {
	title?: string | null;
	target_date?: string | null;
	external_source?: string | null;
	external_id?: string | null;
}

export type PaginatedMilestoneResponse = PaginatedResponse<Milestone>;
export type PaginatedMilestoneWorkItemResponse =
	PaginatedResponse<MilestoneWorkItem>;
