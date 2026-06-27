import type {
	InitiativeStateEnum,
	PaginatedResponse,
	UnknownObject,
} from "./common";

export interface Initiative {
	id: string;
	name: string;
	description?: string | null;
	description_html?: string | null;
	description_stripped?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	logo_props?: UnknownObject;
	state?: InitiativeStateEnum | null;
	lead?: string | null;
	workspace?: string;
	created_at?: string | null;
	updated_at?: string | null;
	deleted_at?: string | null;
	[key: string]: unknown;
}

export interface CreateInitiativeBody {
	name: string;
	description_html?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	logo_props?: UnknownObject | null;
	state?: InitiativeStateEnum | string | null;
	lead?: string | null;
}

export interface UpdateInitiativeBody {
	name?: string | null;
	description_html?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	logo_props?: UnknownObject | null;
	state?: InitiativeStateEnum | string | null;
	lead?: string | null;
}

export type PaginatedInitiativeResponse = PaginatedResponse<Initiative>;
