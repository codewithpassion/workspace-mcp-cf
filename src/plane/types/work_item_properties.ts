import type { PropertyTypeEnum, RelationTypeEnum } from "./common";

export type TextDisplayFormat = "single-line" | "multi-line" | "readonly";
export type DateDisplayFormat =
	| "MMM dd, yyyy"
	| "dd/MM/yyyy"
	| "MM/dd/yyyy"
	| "yyyy/MM/dd";

export interface TextAttributeSettings {
	display_format: TextDisplayFormat;
	[key: string]: unknown;
}

export interface DateAttributeSettings {
	display_format: DateDisplayFormat;
	[key: string]: unknown;
}

export type PropertySettings =
	| TextAttributeSettings
	| DateAttributeSettings
	| Record<string, unknown>
	| null;

export interface WorkItemPropertyOption {
	id?: string | null;
	deleted_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	name: string;
	sort_order?: number | null;
	description?: string | null;
	logo_props?: unknown;
	is_active?: boolean | null;
	is_default?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
	created_by?: string | null;
	updated_by?: string | null;
	workspace?: string | null;
	project?: string | null;
	property?: string | null;
	parent?: string | null;
	[key: string]: unknown;
}

export interface CreateWorkItemPropertyOptionBody {
	name: string;
	description?: string | null;
	is_active?: boolean | null;
	is_default?: boolean | null;
	external_source?: string | null;
	external_id?: string | null;
	parent?: string | null;
}

export interface WorkItemProperty {
	id?: string | null;
	deleted_at?: string | null;
	relation_type?: RelationTypeEnum | null;
	created_at?: string | null;
	updated_at?: string | null;
	name?: string | null;
	display_name: string;
	description?: string | null;
	logo_props?: unknown;
	sort_order?: number | null;
	property_type: PropertyTypeEnum;
	is_required?: boolean | null;
	default_value?: string[] | null;
	settings?: PropertySettings;
	is_active?: boolean | null;
	is_multi?: boolean | null;
	validation_rules?: unknown;
	external_source?: string | null;
	external_id?: string | null;
	created_by?: string | null;
	updated_by?: string | null;
	workspace?: string | null;
	project?: string | null;
	issue_type?: string | null;
	options?: WorkItemPropertyOption[] | null;
	[key: string]: unknown;
}

export interface CreateWorkItemPropertyBody {
	relation_type?: RelationTypeEnum | null;
	display_name: string;
	description?: string | null;
	property_type: PropertyTypeEnum;
	is_required?: boolean | null;
	default_value?: string[] | null;
	settings?: PropertySettings;
	is_active?: boolean | null;
	is_multi?: boolean | null;
	validation_rules?: unknown;
	external_source?: string | null;
	external_id?: string | null;
	options?: CreateWorkItemPropertyOptionBody[] | null;
}

export interface UpdateWorkItemPropertyBody {
	relation_type?: RelationTypeEnum | null;
	display_name?: string | null;
	description?: string | null;
	property_type?: PropertyTypeEnum | null;
	is_required?: boolean | null;
	default_value?: string[] | null;
	settings?: PropertySettings;
	is_active?: boolean | null;
	is_multi?: boolean | null;
	validation_rules?: unknown;
	external_source?: string | null;
	external_id?: string | null;
}
