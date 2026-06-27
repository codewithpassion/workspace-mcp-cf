export interface WorkspaceFeature {
	project_grouping?: boolean | null;
	initiatives?: boolean | null;
	teams?: boolean | null;
	customers?: boolean | null;
	wiki?: boolean | null;
	pi?: boolean | null;
	[key: string]: unknown;
}
