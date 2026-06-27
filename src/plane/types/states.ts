import type { PaginatedResponse, StateGroupEnum } from "./common";

export interface State {
	id?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	deleted_at?: string | null;
	name: string;
	description?: string | null;
	color: string;
	sequence?: number | null;
	group?: StateGroupEnum | null;
	is_triage?: boolean | null;
	default?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
	created_by?: string | null;
	updated_by?: string | null;
	project?: string | null;
	workspace?: string | null;
	[key: string]: unknown;
}

export interface CreateStateBody {
	name: string;
	description?: string | null;
	color: string;
	sequence?: number | null;
	group?: StateGroupEnum | null;
	is_triage?: boolean | null;
	default?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
}

export interface UpdateStateBody {
	name?: string | null;
	description?: string | null;
	color?: string | null;
	sequence?: number | null;
	group?: StateGroupEnum | null;
	is_triage?: boolean | null;
	default?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
}

export type PaginatedStateResponse = PaginatedResponse<State>;
