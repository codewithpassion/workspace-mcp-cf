export interface UserLite {
	id?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	email?: string | null;
	avatar?: string | null;
	avatar_url?: string | null;
	display_name?: string | null;
	[key: string]: unknown;
}
