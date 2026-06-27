// Client-side typed wrappers for /api/configs and /api/google-auth endpoints.
// NOTE: UI components using enabledServices are implemented in P0f.

export type GoogleService =
	| "gmail"
	| "gcalendar"
	| "gdrive"
	| "gdocs"
	| "gsheets"
	| "gslides"
	| "gforms"
	| "gtasks"
	| "gchat"
	| "gcontacts"
	| "gsearch"
	| "gappsscript";

export type ConfigRecord = {
	slug: string;
	displayName: string;
	enabledServices: GoogleService[];
	googleAccountEmail?: string;
	googleAccountSub?: string;
	createdAt: string;
	updatedAt: string;
};

export type CreateConfigInput = {
	slug: string;
	displayName: string;
	enabledServices: GoogleService[];
};

export type UpdateConfigInput = Partial<Omit<CreateConfigInput, "slug">>;

async function request<T>(input: string, init?: RequestInit): Promise<T> {
	const res = await fetch(input, {
		...init,
		headers: {
			...(init?.body ? { "content-type": "application/json" } : {}),
			...init?.headers,
		},
	});
	if (res.status === 204) return undefined as T;
	const text = await res.text();
	const data = text ? JSON.parse(text) : null;
	if (!res.ok) {
		const message =
			(data && (data.error || data.message)) || `HTTP ${res.status}`;
		throw new Error(message);
	}
	return data as T;
}

export const api = {
	list: () => request<ConfigRecord[]>("/api/configs"),
	get: (slug: string) =>
		request<ConfigRecord>(`/api/configs/${encodeURIComponent(slug)}`),
	create: (body: CreateConfigInput) =>
		request<ConfigRecord>("/api/configs", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	update: (slug: string, body: UpdateConfigInput) =>
		request<ConfigRecord>(`/api/configs/${encodeURIComponent(slug)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	remove: (slug: string) =>
		request<void>(`/api/configs/${encodeURIComponent(slug)}`, {
			method: "DELETE",
		}),
	googleAuthStatus: (slug: string) =>
		request<{ connected: boolean; email?: string }>(
			`/api/google-auth/status/${encodeURIComponent(slug)}`,
		),
	googleAuthDisconnect: (slug: string) =>
		request<void>(`/api/google-auth/${encodeURIComponent(slug)}`, {
			method: "DELETE",
		}),
};
