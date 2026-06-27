import type { PaginatedResponse, UnknownObject } from "./common";

export interface Cycle {
	id?: string | null;
	name: string;
	description?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	owned_by?: string | null;
	[key: string]: unknown;
}

export interface CreateCycleBody {
	name: string;
	owned_by: string;
	project_id: string;
	description?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	external_source?: string | null;
	external_id?: string | null;
	timezone?: string | null;
}

export interface UpdateCycleBody {
	name?: string | null;
	description?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	owned_by?: string | null;
	external_source?: string | null;
	external_id?: string | null;
	timezone?: string | null;
}

export interface TransferCycleWorkItemsRequest {
	new_cycle_id: string;
}

export type PaginatedCycleResponse = PaginatedResponse<Cycle>;
export type PaginatedArchivedCycleResponse = PaginatedResponse<Cycle>;
export type PaginatedCycleWorkItemResponse = PaginatedResponse<UnknownObject>;
