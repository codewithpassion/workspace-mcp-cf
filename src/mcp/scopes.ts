// Scope URL mapping for each GoogleService.
// Base URL: https://www.googleapis.com/auth/
// BASE_SCOPES are always included in every consent request.

import type { GoogleService } from "../storage";

const BASE = "https://www.googleapis.com/auth/";

/** Full scope URL list per service, mirroring auth/scopes.py from the Python reference. */
export const SERVICE_SCOPES: Record<GoogleService, string[]> = {
	gmail: [
		`${BASE}gmail.readonly`,
		`${BASE}gmail.send`,
		`${BASE}gmail.compose`,
		`${BASE}gmail.modify`,
		`${BASE}gmail.labels`,
		`${BASE}gmail.settings.basic`,
	],
	gcalendar: [
		`${BASE}calendar`,
		`${BASE}calendar.readonly`,
		`${BASE}calendar.events`,
	],
	gdrive: [`${BASE}drive`, `${BASE}drive.readonly`, `${BASE}drive.file`],
	gdocs: [
		`${BASE}documents.readonly`,
		`${BASE}documents`,
		`${BASE}drive.readonly`,
		`${BASE}drive.file`,
	],
	gsheets: [
		`${BASE}spreadsheets.readonly`,
		`${BASE}spreadsheets`,
		`${BASE}drive.readonly`,
	],
	gslides: [`${BASE}presentations`, `${BASE}presentations.readonly`],
	gforms: [
		`${BASE}forms.body`,
		`${BASE}forms.body.readonly`,
		`${BASE}forms.responses.readonly`,
	],
	gtasks: [`${BASE}tasks`, `${BASE}tasks.readonly`],
	gchat: [
		`${BASE}chat.messages.readonly`,
		`${BASE}chat.messages`,
		`${BASE}chat.spaces`,
		`${BASE}chat.spaces.readonly`,
	],
	gcontacts: [`${BASE}contacts`, `${BASE}contacts.readonly`],
	// Custom Search Engine — no write scope, read-only API key access pattern
	gsearch: [`${BASE}cse`],
	gappsscript: [
		`${BASE}script.projects`,
		`${BASE}script.projects.readonly`,
		`${BASE}script.deployments`,
		`${BASE}script.deployments.readonly`,
		`${BASE}script.processes`,
		`${BASE}script.metrics`,
		`${BASE}script.external_request`,
		`${BASE}script.scriptapp`,
		`${BASE}drive.file`,
	],
};

/** Scopes always requested, regardless of which services are enabled. */
export const BASE_SCOPES = [
	"openid",
	`${BASE}userinfo.email`,
	`${BASE}userinfo.profile`,
];

/**
 * Returns the deduplicated union of scopes for the given services
 * plus the always-required BASE_SCOPES.
 */
export function scopesForServices(services: GoogleService[]): string[] {
	const all = new Set<string>(BASE_SCOPES);
	for (const svc of services) {
		for (const scope of SERVICE_SCOPES[svc]) {
			all.add(scope);
		}
	}
	return Array.from(all);
}
