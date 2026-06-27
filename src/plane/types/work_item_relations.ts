import type { WorkItemRelationTypeEnum } from "./common";

export interface CreateWorkItemRelationBody {
	relation_type: WorkItemRelationTypeEnum;
	issues: string[];
}

export interface RemoveWorkItemRelationBody {
	related_issue: string;
}

export interface WorkItemRelationResponse {
	blocking: string[];
	blocked_by: string[];
	duplicate: string[];
	relates_to: string[];
	start_after: string[];
	start_before: string[];
	finish_after: string[];
	finish_before: string[];
	[key: string]: unknown;
}
