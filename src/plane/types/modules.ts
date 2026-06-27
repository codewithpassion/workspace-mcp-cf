import type {
	ModuleStatusEnum,
	PaginatedResponse,
	UnknownObject,
} from "./common";

export interface Module {
	id?: string | null;
	name: string;
	description?: string | null;
	start_date?: string | null;
	target_date?: string | null;
	status?: ModuleStatusEnum | null;
	lead?: string | null;
	[key: string]: unknown;
}

export interface CreateModuleBody {
	name: string;
	description?: string | null;
	start_date?: string | null;
	target_date?: string | null;
	status?: ModuleStatusEnum | null;
	lead?: string | null;
	members?: string[] | null;
	external_source?: string | null;
	external_id?: string | null;
}

export interface UpdateModuleBody {
	name?: string | null;
	description?: string | null;
	start_date?: string | null;
	target_date?: string | null;
	status?: ModuleStatusEnum | null;
	lead?: string | null;
	members?: string[] | null;
	external_source?: string | null;
	external_id?: string | null;
}

export type PaginatedModuleResponse = PaginatedResponse<Module>;
export type PaginatedArchivedModuleResponse = PaginatedResponse<Module>;
export type PaginatedModuleWorkItemResponse = PaginatedResponse<UnknownObject>;
