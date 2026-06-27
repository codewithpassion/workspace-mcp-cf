import type { UnknownObject } from "./common";

export interface Page {
	id?: string | null;
	name?: string | null;
	description_stripped?: string | null;
	description_html?: string | null;
	description_binary?: string | null;
	description?: UnknownObject | string | null;
	created_at?: string | null;
	updated_at?: string | null;
	owned_by?: string | null;
	anchor?: string | null;
	workspace?: string | null;
	projects?: string[] | null;
	[key: string]: unknown;
}

export interface CreatePageBody {
	name: string;
	description_html: string;
	access?: number | null;
	color?: string | null;
	is_locked?: boolean | null;
	archived_at?: string | null;
	view_props?: UnknownObject | null;
	logo_props?: UnknownObject | null;
	external_id?: string | null;
	external_source?: string | null;
}
