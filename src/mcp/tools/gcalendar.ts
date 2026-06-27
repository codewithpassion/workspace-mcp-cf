// Google Calendar tools — 7 tools for the `gcalendar` service.
//
// Module pattern (same for all 12 service modules):
//   import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
//   import { z } from "zod";
//   import type { ToolContext } from "../google-service";
//   export function register(server: McpServer, ctx: ToolContext): void { ... }
//
// Shared authenticated fetch lives in google-service.ts as googleApiFetch();
// all service modules import it (see calFetch alias below).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── API base URL ──────────────────────────────────────────────────────────────

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

// ─── Authenticated fetch helper ────────────────────────────────────────────────
// Uses the shared googleApiFetch from google-service.ts (all service modules share it).

const calFetch = googleApiFetch;

// ─── URL builder (omits null/undefined params) ────────────────────────────────

function buildUrl(
	base: string,
	params: Record<string, string | number | boolean | null | undefined>,
): string {
	const url = new URL(base);
	for (const [k, v] of Object.entries(params)) {
		if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
	}
	return url.toString();
}

// ─── Response types ────────────────────────────────────────────────────────────

interface EventRecord {
	id?: string;
	summary?: string;
	htmlLink?: string;
	description?: string;
	location?: string;
	colorId?: string;
	start?: { dateTime?: string; date?: string; timeZone?: string };
	end?: { dateTime?: string; date?: string; timeZone?: string };
	attendees?: Array<Record<string, unknown>>;
	creator?: Record<string, unknown>;
	organizer?: Record<string, unknown>;
	recurrence?: string[];
	reminders?: { useDefault?: boolean; overrides?: ReminderObj[] };
	conferenceData?: Record<string, unknown>;
	hangoutLink?: string;
	attachments?: Array<Record<string, unknown>>;
	outOfOfficeProperties?: { autoDeclineMode?: string; declineMessage?: string };
	focusTimeProperties?: {
		autoDeclineMode?: string;
		declineMessage?: string;
		chatStatus?: string;
	};
	eventType?: string;
}

interface EventsListResponse {
	items?: EventRecord[];
}

// ─── Time normalization helpers ────────────────────────────────────────────────

/**
 * Convert local midnight on dateStr (YYYY-MM-DD) in an IANA timezone to UTC.
 * Uses Intl.DateTimeFormat (sv-SE locale → ISO-like "YYYY-MM-DD HH:MM:SS")
 * to compute the UTC offset at that point, then subtracts it.
 */
function getLocalMidnightUTC(dateStr: string, timezone: string): string {
	try {
		const parts = dateStr.split("-");
		const y = Number(parts[0]);
		const m = Number(parts[1]);
		const d = Number(parts[2]);
		const utcMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));

		const fmtOpts: Intl.DateTimeFormatOptions = {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		};
		// sv-SE locale gives "YYYY-MM-DD HH:MM:SS" — parseable by appending "Z"
		const localStr = new Intl.DateTimeFormat("sv-SE", {
			...fmtOpts,
			timeZone: timezone,
		}).format(utcMidnight);
		const utcStr = new Intl.DateTimeFormat("sv-SE", {
			...fmtOpts,
			timeZone: "UTC",
		}).format(utcMidnight);

		// offset = local_at_candidate − utc_at_candidate (positive = east of UTC)
		const localMs = new Date(`${localStr.replace(" ", "T")}Z`).getTime();
		const utcMs = new Date(`${utcStr.replace(" ", "T")}Z`).getTime();
		const offsetMs = localMs - utcMs;

		// UTC time for local midnight = utcMidnight − offset
		return new Date(utcMidnight.getTime() - offsetMs)
			.toISOString()
			.replace(".000Z", "Z");
	} catch {
		return `${dateStr}T00:00:00Z`;
	}
}

/**
 * Normalize a calendar time string into RFC3339 suitable for the Google Calendar API.
 * - Strips surrounding quotes (LLM double-encoding defense).
 * - Date-only (YYYY-MM-DD) → midnight UTC (or midnight in `timezone` if supplied).
 * - YYYY-MM-DDTHH:MM:SS (no offset, 19 chars) → appends Z.
 * - Already-formatted / null → passes through unchanged.
 */
function correctTimeForApi(
	timeStr: string | null | undefined,
	_paramName: string,
	timezone?: string,
): string | null {
	if (!timeStr) return null;
	timeStr = timeStr
		.trim()
		.replace(/^["']+|["']+$/g, "")
		.trim();
	if (
		!timeStr ||
		timeStr.toLowerCase() === "null" ||
		timeStr.toLowerCase() === "none"
	)
		return null;

	if (/^\d{4}-\d{2}-\d{2}$/.test(timeStr)) {
		if (timezone) return getLocalMidnightUTC(timeStr, timezone);
		return `${timeStr}T00:00:00Z`;
	}

	if (
		timeStr.length === 19 &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(timeStr)
	) {
		return `${timeStr}Z`;
	}

	return timeStr;
}

/**
 * Strip trailing UTC offset from a dateTime string so Google Calendar can
 * apply the correct DST-aware offset from an accompanying IANA timeZone field.
 *
 * "2026-03-19T12:00:00-08:00" → "2026-03-19T12:00:00"
 * "2026-03-19T12:00:00Z"      → "2026-03-19T12:00:00"
 * "2026-03-19T12:00:00"       → "2026-03-19T12:00:00" (no-op)
 */
function stripUtcOffset(datetimeStr: string): string {
	if (datetimeStr.endsWith("Z")) return datetimeStr.slice(0, -1);
	return datetimeStr.replace(/[+-]\d{2}:\d{2}$/, "");
}

// ─── Reminder validation ───────────────────────────────────────────────────────

type ReminderObj = { method: string; minutes: number };

function parseRemindersJson(
	input: string | ReminderObj[] | null | undefined,
): ReminderObj[] {
	if (!input) return [];

	let items: unknown[];
	if (typeof input === "string") {
		try {
			const parsed: unknown = JSON.parse(input);
			if (!Array.isArray(parsed)) return [];
			items = parsed;
		} catch {
			return [];
		}
	} else {
		items = input;
	}

	if (items.length > 5) items = items.slice(0, 5);

	const validated: ReminderObj[] = [];
	for (const r of items) {
		if (typeof r !== "object" || r === null) continue;
		const rec = r as Record<string, unknown>;
		if (!("method" in rec) || !("minutes" in rec)) continue;
		const method = String(rec.method).toLowerCase();
		const minutes = Number(rec.minutes);
		if (!["popup", "email"].includes(method)) continue;
		if (!Number.isInteger(minutes) || minutes < 0 || minutes > 40320) continue;
		validated.push({ method, minutes });
	}
	return validated;
}

// ─── Transparency / visibility validators ─────────────────────────────────────

const VALID_TRANSPARENCY = new Set(["opaque", "transparent"]);
const VALID_VISIBILITY = new Set([
	"default",
	"public",
	"private",
	"confidential",
]);

function applyTransparencyIfValid(
	body: Record<string, unknown>,
	t: string | null | undefined,
): void {
	if (t && VALID_TRANSPARENCY.has(t)) body.transparency = t;
}

function applyVisibilityIfValid(
	body: Record<string, unknown>,
	v: string | null | undefined,
): void {
	if (v && VALID_VISIBILITY.has(v)) body.visibility = v;
}

// ─── Auto-decline mode ────────────────────────────────────────────────────────

const VALID_AUTO_DECLINE = new Set([
	"declineAllConflictingInvitations",
	"declineOnlyNewConflictingInvitations",
	"declineNone",
]);

function validateAutoDeclineMode(mode: string | null | undefined): string {
	if (!mode) return "declineAllConflictingInvitations";
	if (!VALID_AUTO_DECLINE.has(mode))
		throw new Error(
			`Invalid auto_decline_mode "${mode}". Must be one of: ${[...VALID_AUTO_DECLINE].sort().join(", ")}`,
		);
	return mode;
}

// ─── OOO / FocusTime time entry builders ──────────────────────────────────────
//
// Google Calendar requires dateTime (not date) for outOfOffice / focusTime events.
// Date-only strings are auto-converted to T00:00:00 (midnight) in the given timezone.

function oooTimeEntry(
	timeStr: string,
	timezone?: string,
): Record<string, string> {
	if (!timeStr.includes("T")) timeStr = `${timeStr}T00:00:00`;
	const hasOffset = timeStr.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(timeStr);
	if (!hasOffset && !timezone)
		throw new Error(
			"Out of Office events require either a timezone parameter or a " +
				"start/end timestamp with an explicit UTC offset.",
		);
	const entry: Record<string, string> = { dateTime: timeStr };
	if (timezone) entry.timeZone = timezone;
	return entry;
}

function focusTimeTimeEntry(
	timeStr: string,
	timezone?: string,
): Record<string, string> {
	if (!timeStr.includes("T")) timeStr = `${timeStr}T00:00:00`;
	const hasOffset = timeStr.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(timeStr);
	if (!hasOffset && !timezone)
		throw new Error(
			"Focus Time events require either a timezone parameter or a " +
				"start/end timestamp with an explicit UTC offset.",
		);
	const entry: Record<string, string> = { dateTime: timeStr };
	if (timezone) entry.timeZone = timezone;
	return entry;
}

// ─── Conference data builders ─────────────────────────────────────────────────

const CONFERENCE_SOLUTION_NAMES: Record<string, string> = {
	zoom: "Zoom Meeting",
	webex: "Webex",
	teams: "Microsoft Teams",
	"microsoft teams": "Microsoft Teams",
};

function buildAddonConferenceData(
	provider: string,
	uri: string,
	passcode?: string,
	conferenceId?: string,
): Record<string, unknown> {
	const name =
		CONFERENCE_SOLUTION_NAMES[provider.toLowerCase()] ?? provider.trim();
	const entryPoint: Record<string, unknown> = {
		entryPointType: "video",
		uri: uri.trim(),
		label: name,
	};
	if (passcode) entryPoint.passcode = passcode;
	const data: Record<string, unknown> = {
		conferenceSolution: { key: { type: "addOn" }, name },
		entryPoints: [entryPoint],
	};
	if (conferenceId) data.conferenceId = conferenceId;
	return data;
}

function resolveConferenceData(
	conferenceData: Record<string, unknown> | null | undefined,
	conferenceProvider: string | null | undefined,
	conferenceUri: string | null | undefined,
	conferencePasscode: string | null | undefined,
	conferenceId: string | null | undefined,
	addGoogleMeet: boolean | null | undefined,
): Record<string, unknown> | null {
	const helperUsed = !!(
		conferenceProvider ||
		conferenceUri ||
		conferencePasscode ||
		conferenceId
	);
	if (conferenceData != null && helperUsed)
		throw new Error(
			"Provide either conference_data (raw payload) or the " +
				"conference_provider/conference_uri helper params, not both.",
		);
	let resolved: Record<string, unknown> | null = conferenceData ?? null;
	if (helperUsed) {
		const provider = (conferenceProvider ?? "").trim();
		const uri = (conferenceUri ?? "").trim();
		if (!provider || !uri)
			throw new Error(
				"conference_provider and conference_uri are both required to " +
					"attach a third-party conference.",
			);
		resolved = buildAddonConferenceData(
			provider,
			uri,
			conferencePasscode ?? undefined,
			conferenceId ?? undefined,
		);
	}
	if (resolved !== null && addGoogleMeet)
		throw new Error(
			"Cannot attach a third-party conference and add_google_meet on the " +
				"same event; choose one.",
		);
	return resolved;
}

// ─── Attendee normalization ────────────────────────────────────────────────────

type AttendeeInput = string | Record<string, unknown>;
type AttendeeObj = Record<string, unknown> & { email: string };

function normalizeAttendees(
	attendees: AttendeeInput[] | null | undefined,
): AttendeeObj[] | null {
	if (!attendees) return null;
	const out: AttendeeObj[] = [];
	for (const att of attendees) {
		if (typeof att === "string") {
			out.push({ email: att });
		} else if (
			typeof att === "object" &&
			att !== null &&
			typeof att.email === "string"
		) {
			out.push(att as AttendeeObj);
		}
	}
	return out.length > 0 ? out : null;
}

// ─── Preserve-existing helper (read-modify-write) ─────────────────────────────

function preserveExistingFields(
	body: Record<string, unknown>,
	existing: Record<string, unknown>,
	fieldMappings: Record<string, unknown>,
): void {
	for (const [field, newValue] of Object.entries(fieldMappings)) {
		if (newValue === undefined || newValue === null) {
			if (field in existing) body[field] = existing[field];
		} else {
			body[field] = newValue;
		}
	}
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function getMeetingLink(event: Record<string, unknown>): string {
	const confData = event.conferenceData as Record<string, unknown> | undefined;
	if (confData) {
		const eps = confData.entryPoints as
			| Array<Record<string, unknown>>
			| undefined;
		if (eps) {
			for (const ep of eps) {
				if (
					ep.entryPointType === "video" &&
					typeof ep.uri === "string" &&
					ep.uri
				)
					return ep.uri;
			}
		}
	}
	return typeof event.hangoutLink === "string" ? event.hangoutLink : "";
}

function formatPerson(person: Record<string, unknown> | undefined): string {
	if (!person) return "";
	const email = typeof person.email === "string" ? person.email : "";
	const name = typeof person.displayName === "string" ? person.displayName : "";
	const self = person.self === true ? " (you)" : "";
	if (name && email) return `${name} <${email}>${self}`;
	return email ? `${email}${self}` : name;
}

function formatAttendeeDetails(
	attendees: Array<Record<string, unknown>>,
	indent = "  ",
): string {
	if (!attendees || attendees.length === 0) return "None";
	return attendees
		.map((a) => {
			const email = typeof a.email === "string" ? a.email : "unknown";
			const status =
				typeof a.responseStatus === "string" ? a.responseStatus : "unknown";
			const parts = [`${email}: ${status}`];
			if (a.organizer) parts.push("(organizer)");
			if (a.optional) parts.push("(optional)");
			return parts.join(" ");
		})
		.join(`\n${indent}`);
}

function formatAttachmentDetails(
	attachments: Array<Record<string, unknown>>,
	indent = "  ",
): string {
	if (!attachments || attachments.length === 0) return "None";
	return attachments
		.map((att) => {
			const title = typeof att.title === "string" ? att.title : "Untitled";
			const fileUrl = typeof att.fileUrl === "string" ? att.fileUrl : "No URL";
			const fileId = typeof att.fileId === "string" ? att.fileId : "No ID";
			const mimeType =
				typeof att.mimeType === "string" ? att.mimeType : "Unknown";
			return (
				`${title}\n${indent}File URL: ${fileUrl}\n` +
				`${indent}File ID: ${fileId}\n${indent}MIME Type: ${mimeType}`
			);
		})
		.join(`\n${indent}`);
}

// ─── Event CRUD implementations ────────────────────────────────────────────────

interface CreateEventParams {
	summary: string;
	startTime: string;
	endTime: string;
	calendarId: string;
	description?: string;
	location?: string;
	attendees?: AttendeeInput[];
	timezone?: string;
	attachments?: string[];
	addGoogleMeet: boolean;
	conferenceData: Record<string, unknown> | null;
	reminders?: string | ReminderObj[];
	useDefaultReminders: boolean;
	transparency?: string;
	visibility?: string;
	recurrence?: string[];
	guestsCanModify?: boolean;
	guestsCanInviteOthers?: boolean;
	guestsCanSeeOtherGuests?: boolean;
	sendUpdates: string;
}

async function createEventImpl(
	accessToken: string,
	p: CreateEventParams,
): Promise<string> {
	// When IANA timezone provided, strip UTC offset from dateTime values so Google
	// Calendar resolves the correct DST-aware offset from the IANA name.
	const effectiveStart =
		p.timezone && p.startTime.includes("T")
			? stripUtcOffset(p.startTime)
			: p.startTime;
	const effectiveEnd =
		p.timezone && p.endTime.includes("T")
			? stripUtcOffset(p.endTime)
			: p.endTime;

	const body: Record<string, unknown> = {
		summary: p.summary,
		start: p.startTime.includes("T")
			? { dateTime: effectiveStart }
			: { date: p.startTime },
		end: p.endTime.includes("T")
			? { dateTime: effectiveEnd }
			: { date: p.endTime },
	};

	if (p.timezone) {
		const start = body.start as Record<string, string>;
		if ("dateTime" in start) start.timeZone = p.timezone;
		const end = body.end as Record<string, string>;
		if ("dateTime" in end) end.timeZone = p.timezone;
	}
	if (p.recurrence) body.recurrence = p.recurrence;
	if (p.location) body.location = p.location;
	if (p.description) body.description = p.description;
	if (p.attendees)
		body.attendees = p.attendees.map((a) =>
			typeof a === "string" ? { email: a } : a,
		);

	// Reminders
	if (p.reminders !== undefined || !p.useDefaultReminders) {
		const effectiveUseDefault =
			p.useDefaultReminders && p.reminders === undefined;
		const reminderData: Record<string, unknown> = {
			useDefault: effectiveUseDefault,
		};
		if (p.reminders !== undefined) {
			const validated = parseRemindersJson(p.reminders);
			if (validated.length > 0) reminderData.overrides = validated;
		}
		body.reminders = reminderData;
	}

	applyTransparencyIfValid(body, p.transparency);
	applyVisibilityIfValid(body, p.visibility);
	if (p.guestsCanModify !== undefined) body.guestsCanModify = p.guestsCanModify;
	if (p.guestsCanInviteOthers !== undefined)
		body.guestsCanInviteOthers = p.guestsCanInviteOthers;
	if (p.guestsCanSeeOtherGuests !== undefined)
		body.guestsCanSeeOtherGuests = p.guestsCanSeeOtherGuests;

	if (p.addGoogleMeet) {
		body.conferenceData = {
			createRequest: {
				requestId: crypto.randomUUID(),
				conferenceSolutionKey: { type: "hangoutsMeet" },
			},
		};
	} else if (p.conferenceData !== null) {
		body.conferenceData = p.conferenceData;
	}

	const conferenceDataVersion =
		p.addGoogleMeet || p.conferenceData !== null ? 1 : 0;

	// Attachments: Drive metadata lookup requires Drive scope (unavailable in calendar-only
	// context), so we use fallback title/mimeType — same behaviour as Python's fallback.
	if (p.attachments && p.attachments.length > 0) {
		body.attachments = p.attachments.map((att) => {
			let fileId: string;
			if (att.startsWith("https://")) {
				const m = /(?:\/d\/|\/file\/d\/|id=)([\w-]+)/.exec(att);
				fileId = m ? m[1] : att;
			} else {
				fileId = att;
			}
			return {
				fileUrl: `https://drive.google.com/open?id=${fileId}`,
				title: "Drive Attachment",
				mimeType: "application/vnd.google-apps.drive-sdk",
			};
		});
	}

	const url = buildUrl(
		`${CAL_BASE}/calendars/${encodeURIComponent(p.calendarId)}/events`,
		{
			conferenceDataVersion,
			sendUpdates: p.sendUpdates,
			supportsAttachments:
				p.attachments && p.attachments.length > 0 ? true : undefined,
		},
	);
	const created = (await calFetch(accessToken, url, {
		method: "POST",
		body: JSON.stringify(body),
	})) as EventRecord;

	let msg = `Successfully created event '${created.summary ?? p.summary}'. Link: ${created.htmlLink ?? "N/A"}`;
	if (p.addGoogleMeet || p.conferenceData !== null) {
		const link = getMeetingLink(created as Record<string, unknown>);
		if (link)
			msg += ` ${p.addGoogleMeet ? "Google Meet" : "Conference"}: ${link}`;
	}
	return msg;
}

interface ModifyEventParams {
	eventId: string;
	calendarId: string;
	summary?: string;
	startTime?: string;
	endTime?: string;
	description?: string;
	location?: string;
	attendees?: AttendeeInput[];
	timezone?: string;
	addGoogleMeet?: boolean; // tri-state: undefined = preserve, true = add, false = remove
	conferenceData?: Record<string, unknown> | null;
	reminders?: string | ReminderObj[];
	useDefaultReminders?: boolean; // tri-state: undefined = preserve from existing
	transparency?: string;
	visibility?: string;
	colorId?: string;
	recurrence?: string[];
	guestsCanModify?: boolean;
	guestsCanInviteOthers?: boolean;
	guestsCanSeeOtherGuests?: boolean;
	sendUpdates: string;
}

async function modifyEventImpl(
	accessToken: string,
	p: ModifyEventParams,
): Promise<string> {
	const eventsBase = `${CAL_BASE}/calendars/${encodeURIComponent(p.calendarId)}/events`;
	const body: Record<string, unknown> = {};

	if (p.summary !== undefined) body.summary = p.summary;

	if (p.startTime !== undefined) {
		const eff =
			p.timezone && p.startTime.includes("T")
				? stripUtcOffset(p.startTime)
				: p.startTime;
		body.start = p.startTime.includes("T")
			? { dateTime: eff }
			: { date: p.startTime };
		if (p.timezone && "dateTime" in (body.start as Record<string, unknown>))
			(body.start as Record<string, string>).timeZone = p.timezone;
	}
	if (p.endTime !== undefined) {
		const eff =
			p.timezone && p.endTime.includes("T")
				? stripUtcOffset(p.endTime)
				: p.endTime;
		body.end = p.endTime.includes("T")
			? { dateTime: eff }
			: { date: p.endTime };
		if (p.timezone && "dateTime" in (body.end as Record<string, unknown>))
			(body.end as Record<string, string>).timeZone = p.timezone;
	}
	if (p.description !== undefined) body.description = p.description;
	if (p.location !== undefined) body.location = p.location;

	const normAttendees = normalizeAttendees(p.attendees ?? null);
	if (normAttendees !== null) body.attendees = normAttendees;

	if (p.colorId !== undefined) body.colorId = p.colorId;
	if (p.recurrence !== undefined) body.recurrence = p.recurrence;

	// Reminders — tri-state: preserve if neither field provided
	if (p.reminders !== undefined || p.useDefaultReminders !== undefined) {
		let useDefault = true;
		if (p.useDefaultReminders === undefined) {
			// Preserve existing event's useDefault via pre-fetch
			try {
				const existing = (await calFetch(
					accessToken,
					`${eventsBase}/${encodeURIComponent(p.eventId)}`,
				)) as EventRecord;
				useDefault = existing.reminders?.useDefault ?? true;
			} catch {
				// fallback
			}
		} else {
			useDefault = p.useDefaultReminders;
		}
		const reminderData: Record<string, unknown> = { useDefault };
		if (p.reminders !== undefined) {
			// Custom reminders disable default
			if (reminderData.useDefault) reminderData.useDefault = false;
			const validated = parseRemindersJson(p.reminders);
			if (validated.length > 0) reminderData.overrides = validated;
		}
		body.reminders = reminderData;
	}

	applyTransparencyIfValid(body, p.transparency);
	applyVisibilityIfValid(body, p.visibility);
	if (p.guestsCanModify !== undefined) body.guestsCanModify = p.guestsCanModify;
	if (p.guestsCanInviteOthers !== undefined)
		body.guestsCanInviteOthers = p.guestsCanInviteOthers;
	if (p.guestsCanSeeOtherGuests !== undefined)
		body.guestsCanSeeOtherGuests = p.guestsCanSeeOtherGuests;

	// Conference data — tri-state for addGoogleMeet (undefined = don't touch)
	if (p.conferenceData !== undefined && p.conferenceData !== null) {
		body.conferenceData = p.conferenceData;
	} else if (p.addGoogleMeet !== undefined) {
		if (p.addGoogleMeet) {
			body.conferenceData = {
				createRequest: {
					requestId: crypto.randomUUID(),
					conferenceSolutionKey: { type: "hangoutsMeet" },
				},
			};
		} else {
			body.conferenceData = null; // must be null (not undefined) to remove Meet
		}
	}

	if (Object.keys(body).length === 0)
		throw new Error("No fields provided to modify the event.");

	// Read-modify-write: fetch existing to preserve unspecified fields
	try {
		const existing = (await calFetch(
			accessToken,
			`${eventsBase}/${encodeURIComponent(p.eventId)}`,
		)) as EventRecord;
		preserveExistingFields(body, existing as Record<string, unknown>, {
			summary: p.summary ?? null,
			description: p.description ?? null,
			location: p.location ?? null,
			attendees: body.attendees ?? null,
			colorId: body.colorId ?? null,
			recurrence: p.recurrence ?? null,
		});
	} catch (err) {
		if (err instanceof Error && err.message.includes("Calendar API 404")) {
			throw new Error(
				`Event not found. The event with ID '${p.eventId}' could not be found in calendar '${p.calendarId}'.`,
			);
		}
		// Non-404: proceed optimistically
	}

	const url = buildUrl(`${eventsBase}/${encodeURIComponent(p.eventId)}`, {
		conferenceDataVersion: 1,
		sendUpdates: p.sendUpdates,
	});
	const updated = (await calFetch(accessToken, url, {
		method: "PATCH",
		body: JSON.stringify(body),
	})) as EventRecord;

	let msg = `Successfully modified event '${updated.summary ?? p.summary}' (ID: ${p.eventId}). Link: ${updated.htmlLink ?? "N/A"}`;
	const updatedRec = updated as Record<string, unknown>;
	if (p.conferenceData !== undefined && p.conferenceData !== null) {
		const link = getMeetingLink(updatedRec);
		if (link) msg += ` Conference: ${link}`;
	} else if (p.addGoogleMeet === true) {
		const link = getMeetingLink(updatedRec);
		if (link) msg += ` Google Meet: ${link}`;
	} else if (p.addGoogleMeet === false) {
		msg += " (Google Meet removed)";
	}
	return msg;
}

async function deleteEventImpl(
	accessToken: string,
	eventId: string,
	calendarId: string,
	sendUpdates: string,
): Promise<string> {
	const eventsBase = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
	// Pre-verify event exists
	try {
		await calFetch(accessToken, `${eventsBase}/${encodeURIComponent(eventId)}`);
	} catch (err) {
		if (err instanceof Error && err.message.includes("Calendar API 404")) {
			throw new Error(
				`Event not found. The event with ID '${eventId}' could not be found in calendar '${calendarId}'.`,
			);
		}
	}
	const url = buildUrl(`${eventsBase}/${encodeURIComponent(eventId)}`, {
		sendUpdates,
	});
	await calFetch(accessToken, url, { method: "DELETE" });
	return `Successfully deleted event (ID: ${eventId}) from calendar '${calendarId}'.`;
}

async function rsvpEventImpl(
	accessToken: string,
	eventId: string,
	response: string,
	calendarId: string,
	comment?: string,
	sendUpdates = "all",
): Promise<string> {
	const VALID = new Set(["accepted", "declined", "tentative", "needsAction"]);
	if (!VALID.has(response))
		throw new Error(
			`Invalid response '${response}'. Must be one of: ${[...VALID].sort().join(", ")}`,
		);

	const eventsBase = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
	const existing = (await calFetch(
		accessToken,
		`${eventsBase}/${encodeURIComponent(eventId)}`,
	)) as EventRecord;

	const attendees = existing.attendees;
	if (!attendees || attendees.length === 0)
		throw new Error("This event has no attendee list; cannot update RSVP.");

	if (
		typeof existing.organizer === "object" &&
		existing.organizer !== null &&
		existing.organizer.self === true
	)
		throw new Error(
			"You are the organizer of this event. Organizers cannot respond to their own invitations.",
		);

	const userIdx = attendees.findIndex((a) => a.self === true);
	if (userIdx === -1)
		throw new Error("You were not found in the event's attendee list.");

	const updatedAttendees = attendees.map((a) => ({ ...a }));
	updatedAttendees[userIdx].responseStatus = response;
	if (comment !== undefined) updatedAttendees[userIdx].comment = comment;

	const url = buildUrl(`${eventsBase}/${encodeURIComponent(eventId)}`, {
		sendUpdates,
	});
	const updated = (await calFetch(accessToken, url, {
		method: "PATCH",
		body: JSON.stringify({ attendees: updatedAttendees }),
	})) as EventRecord;

	return `Successfully updated RSVP for '${updated.summary ?? "Unknown event"}' (ID: ${eventId}) to '${response}'.`;
}

// ─── Out of Office implementations ────────────────────────────────────────────

interface OooParams {
	startTime: string;
	endTime: string;
	calendarId: string;
	summary?: string;
	autoDeclineMode?: string;
	declineMessage?: string;
	recurrence?: string[];
	timezone?: string;
}

async function createOooEventImpl(
	accessToken: string,
	p: OooParams,
): Promise<string> {
	const effectiveSummary = p.summary ?? "Out of Office";
	const declineMode = validateAutoDeclineMode(p.autoDeclineMode);

	const body: Record<string, unknown> = {
		eventType: "outOfOffice",
		summary: effectiveSummary,
		start: oooTimeEntry(p.startTime, p.timezone),
		end: oooTimeEntry(p.endTime, p.timezone),
		outOfOfficeProperties: {
			autoDeclineMode: declineMode,
			declineMessage: p.declineMessage ?? "",
		},
		transparency: "opaque",
	};
	if (p.recurrence) body.recurrence = p.recurrence;

	const created = (await calFetch(
		accessToken,
		`${CAL_BASE}/calendars/${encodeURIComponent(p.calendarId)}/events`,
		{ method: "POST", body: JSON.stringify(body) },
	)) as EventRecord;

	return [
		"Successfully created Out of Office event.",
		`- Summary: ${effectiveSummary}`,
		`- Start: ${created.start?.date ?? created.start?.dateTime ?? "N/A"}`,
		`- End: ${created.end?.date ?? created.end?.dateTime ?? "N/A"}`,
		`- Auto-decline: ${declineMode}`,
		`- Decline message: ${p.declineMessage ?? "(none)"}`,
		`- Event ID: ${created.id ?? "N/A"}`,
		`- Link: ${created.htmlLink ?? "N/A"}`,
	].join("\n");
}

async function listOooEventsImpl(
	accessToken: string,
	calendarId: string,
	timeMin?: string,
	timeMax?: string,
	maxResults = 10,
	timezone?: string,
): Promise<string> {
	let effectiveTimeMin = correctTimeForApi(timeMin, "time_min", timezone);
	if (!effectiveTimeMin) effectiveTimeMin = new Date().toISOString();
	const effectiveTimeMax = correctTimeForApi(timeMax, "time_max", timezone);

	const url = buildUrl(
		`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
		{
			timeMin: effectiveTimeMin,
			timeMax: effectiveTimeMax,
			maxResults,
			singleEvents: true,
			orderBy: "startTime",
			eventTypes: "outOfOffice",
		},
	);
	const result = (await calFetch(accessToken, url)) as EventsListResponse;
	const items = result.items ?? [];
	if (items.length === 0) return "No out-of-office events found.";

	const lines = [`Found ${items.length} out-of-office event(s):\n`];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const s = item.start?.date ?? item.start?.dateTime ?? "N/A";
		const e = item.end?.date ?? item.end?.dateTime ?? "N/A";
		const ooo = item.outOfOfficeProperties ?? {};
		lines.push(`${i + 1}. "${item.summary ?? "Out of Office"}" (${s} to ${e})`);
		lines.push(`   Auto-decline: ${ooo.autoDeclineMode ?? "N/A"}`);
		if (ooo.declineMessage)
			lines.push(`   Decline message: ${ooo.declineMessage}`);
		lines.push(`   Event ID: ${item.id ?? "N/A"}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

async function updateOooEventImpl(
	accessToken: string,
	eventId: string,
	calendarId: string,
	startTime?: string,
	endTime?: string,
	summary?: string,
	autoDeclineMode?: string,
	declineMessage?: string,
	recurrence?: string[],
	timezone?: string,
): Promise<string> {
	const eventsBase = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
	const existing = (await calFetch(
		accessToken,
		`${eventsBase}/${encodeURIComponent(eventId)}`,
	)) as EventRecord;

	if (existing.eventType !== "outOfOffice")
		throw new Error(
			`Event '${eventId}' is not an Out of Office event. Use manage_event to update regular events.`,
		);

	const patch: Record<string, unknown> = {};
	if (summary !== undefined) patch.summary = summary;
	if (startTime !== undefined) patch.start = oooTimeEntry(startTime, timezone);
	if (endTime !== undefined) patch.end = oooTimeEntry(endTime, timezone);
	if (recurrence !== undefined) patch.recurrence = recurrence;

	if (autoDeclineMode !== undefined || declineMessage !== undefined) {
		const existingOoo = existing.outOfOfficeProperties ?? {};
		patch.outOfOfficeProperties = {
			autoDeclineMode:
				autoDeclineMode !== undefined
					? validateAutoDeclineMode(autoDeclineMode)
					: (existingOoo.autoDeclineMode ?? "declineAllConflictingInvitations"),
			declineMessage:
				declineMessage !== undefined
					? declineMessage
					: (existingOoo.declineMessage ?? ""),
		};
	}

	if (Object.keys(patch).length === 0)
		return `No changes specified for Out of Office event '${eventId}'.`;

	const updated = (await calFetch(
		accessToken,
		`${eventsBase}/${encodeURIComponent(eventId)}`,
		{ method: "PATCH", body: JSON.stringify(patch) },
	)) as EventRecord;

	return [
		`Successfully updated Out of Office event (ID: ${eventId}).`,
		`- Summary: ${updated.summary ?? "Out of Office"}`,
		`- Start: ${updated.start?.date ?? updated.start?.dateTime ?? "N/A"}`,
		`- End: ${updated.end?.date ?? updated.end?.dateTime ?? "N/A"}`,
		`- Link: ${updated.htmlLink ?? "N/A"}`,
	].join("\n");
}

async function deleteOooEventImpl(
	accessToken: string,
	eventId: string,
	calendarId: string,
): Promise<string> {
	const eventsBase = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
	const existing = (await calFetch(
		accessToken,
		`${eventsBase}/${encodeURIComponent(eventId)}`,
	)) as EventRecord;
	if (existing.eventType !== "outOfOffice")
		throw new Error(
			`Event '${eventId}' is not an Out of Office event. Use manage_event to delete regular events.`,
		);
	await calFetch(accessToken, `${eventsBase}/${encodeURIComponent(eventId)}`, {
		method: "DELETE",
	});
	return `Successfully deleted Out of Office event (ID: ${eventId}) from calendar '${calendarId}'.`;
}

// ─── Focus Time implementations ────────────────────────────────────────────────

const VALID_CHAT_STATUSES = new Set(["available", "doNotDisturb"]);

function validateChatStatus(status: string | null | undefined): string | null {
	if (!status) return null;
	if (!VALID_CHAT_STATUSES.has(status))
		throw new Error(
			`Invalid chat_status '${status}'. Must be one of: ${[...VALID_CHAT_STATUSES].sort().join(", ")}`,
		);
	return status;
}

interface FocusTimeParams {
	startTime: string;
	endTime: string;
	calendarId: string;
	summary?: string;
	description?: string;
	autoDeclineMode?: string;
	declineMessage?: string;
	chatStatus?: string;
	recurrence?: string[];
	timezone?: string;
}

async function createFocusTimeEventImpl(
	accessToken: string,
	p: FocusTimeParams,
): Promise<string> {
	const effectiveSummary = p.summary ?? "Focus Time";
	const declineMode = validateAutoDeclineMode(p.autoDeclineMode);
	const chatStatus = validateChatStatus(p.chatStatus ?? "doNotDisturb");

	const ftProps: Record<string, string> = {
		autoDeclineMode: declineMode,
		declineMessage: p.declineMessage ?? "",
	};
	if (chatStatus) ftProps.chatStatus = chatStatus;

	const body: Record<string, unknown> = {
		eventType: "focusTime",
		summary: effectiveSummary,
		start: focusTimeTimeEntry(p.startTime, p.timezone),
		end: focusTimeTimeEntry(p.endTime, p.timezone),
		focusTimeProperties: ftProps,
		transparency: "opaque",
	};
	if (p.description) body.description = p.description;
	if (p.recurrence) body.recurrence = p.recurrence;

	const created = (await calFetch(
		accessToken,
		`${CAL_BASE}/calendars/${encodeURIComponent(p.calendarId)}/events`,
		{ method: "POST", body: JSON.stringify(body) },
	)) as EventRecord;

	const createdFt = created.focusTimeProperties ?? {};
	return [
		"Successfully created Focus Time event.",
		`- Summary: ${effectiveSummary}`,
		`- Start: ${created.start?.date ?? created.start?.dateTime ?? "N/A"}`,
		`- End: ${created.end?.date ?? created.end?.dateTime ?? "N/A"}`,
		`- Auto-decline: ${declineMode}`,
		`- Decline message: ${p.declineMessage ?? "(none)"}`,
		`- Chat status: ${createdFt.chatStatus ?? "(default)"}`,
		`- Event ID: ${created.id ?? "N/A"}`,
		`- Link: ${created.htmlLink ?? "N/A"}`,
	].join("\n");
}

async function listFocusTimeEventsImpl(
	accessToken: string,
	calendarId: string,
	timeMin?: string,
	timeMax?: string,
	maxResults = 10,
	timezone?: string,
): Promise<string> {
	let effectiveTimeMin = correctTimeForApi(timeMin, "time_min", timezone);
	if (!effectiveTimeMin) effectiveTimeMin = new Date().toISOString();
	const effectiveTimeMax = correctTimeForApi(timeMax, "time_max", timezone);

	const url = buildUrl(
		`${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
		{
			timeMin: effectiveTimeMin,
			timeMax: effectiveTimeMax,
			maxResults,
			singleEvents: true,
			orderBy: "startTime",
			eventTypes: "focusTime",
		},
	);
	const result = (await calFetch(accessToken, url)) as EventsListResponse;
	const items = result.items ?? [];
	if (items.length === 0) return "No Focus Time events found.";

	const lines = [`Found ${items.length} Focus Time event(s):\n`];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const s = item.start?.date ?? item.start?.dateTime ?? "N/A";
		const e = item.end?.date ?? item.end?.dateTime ?? "N/A";
		const ft = item.focusTimeProperties ?? {};
		lines.push(`${i + 1}. "${item.summary ?? "Focus Time"}" (${s} to ${e})`);
		lines.push(`   Auto-decline: ${ft.autoDeclineMode ?? "N/A"}`);
		if (ft.declineMessage)
			lines.push(`   Decline message: ${ft.declineMessage}`);
		if (ft.chatStatus) lines.push(`   Chat status: ${ft.chatStatus}`);
		lines.push(`   Event ID: ${item.id ?? "N/A"}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

async function updateFocusTimeEventImpl(
	accessToken: string,
	eventId: string,
	calendarId: string,
	startTime?: string,
	endTime?: string,
	summary?: string,
	description?: string,
	autoDeclineMode?: string,
	declineMessage?: string,
	chatStatus?: string,
	recurrence?: string[],
	timezone?: string,
): Promise<string> {
	const eventsBase = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
	const existing = (await calFetch(
		accessToken,
		`${eventsBase}/${encodeURIComponent(eventId)}`,
	)) as EventRecord;

	if (existing.eventType !== "focusTime")
		throw new Error(
			`Event '${eventId}' is not a Focus Time event. Use manage_event to update regular events.`,
		);

	const patch: Record<string, unknown> = {};
	if (summary !== undefined) patch.summary = summary;
	if (description !== undefined) patch.description = description;
	if (startTime !== undefined)
		patch.start = focusTimeTimeEntry(startTime, timezone);
	if (endTime !== undefined) patch.end = focusTimeTimeEntry(endTime, timezone);
	if (recurrence !== undefined) patch.recurrence = recurrence;

	if (
		autoDeclineMode !== undefined ||
		declineMessage !== undefined ||
		chatStatus !== undefined
	) {
		const existingFt = existing.focusTimeProperties ?? {};
		const updatedFt: Record<string, string> = {
			autoDeclineMode:
				autoDeclineMode !== undefined
					? validateAutoDeclineMode(autoDeclineMode)
					: (existingFt.autoDeclineMode ?? "declineAllConflictingInvitations"),
			declineMessage:
				declineMessage !== undefined
					? declineMessage
					: (existingFt.declineMessage ?? ""),
		};
		if (chatStatus !== undefined) {
			const v = validateChatStatus(chatStatus);
			if (v) updatedFt.chatStatus = v;
		} else if (existingFt.chatStatus) {
			updatedFt.chatStatus = existingFt.chatStatus;
		}
		patch.focusTimeProperties = updatedFt;
	}

	if (Object.keys(patch).length === 0)
		return `No changes specified for Focus Time event '${eventId}'.`;

	const updated = (await calFetch(
		accessToken,
		`${eventsBase}/${encodeURIComponent(eventId)}`,
		{ method: "PATCH", body: JSON.stringify(patch) },
	)) as EventRecord;

	return [
		`Successfully updated Focus Time event (ID: ${eventId}).`,
		`- Summary: ${updated.summary ?? "Focus Time"}`,
		`- Start: ${updated.start?.date ?? updated.start?.dateTime ?? "N/A"}`,
		`- End: ${updated.end?.date ?? updated.end?.dateTime ?? "N/A"}`,
		`- Link: ${updated.htmlLink ?? "N/A"}`,
	].join("\n");
}

async function deleteFocusTimeEventImpl(
	accessToken: string,
	eventId: string,
	calendarId: string,
): Promise<string> {
	const eventsBase = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
	const existing = (await calFetch(
		accessToken,
		`${eventsBase}/${encodeURIComponent(eventId)}`,
	)) as EventRecord;
	if (existing.eventType !== "focusTime")
		throw new Error(
			`Event '${eventId}' is not a Focus Time event. Use manage_event to delete regular events.`,
		);
	await calFetch(accessToken, `${eventsBase}/${encodeURIComponent(eventId)}`, {
		method: "DELETE",
	});
	return `Successfully deleted Focus Time event (ID: ${eventId}) from calendar '${calendarId}'.`;
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. list_calendars ──────────────────────────────────────────────────────
	server.tool(
		"list_calendars",
		"List all Google Calendars accessible to the connected account.",
		{},
		async () => {
			const { accessToken } = await ctx.getService("gcalendar");
			const data = (await calFetch(
				accessToken,
				`${CAL_BASE}/users/me/calendarList`,
			)) as {
				items?: Array<{ id: string; summary?: string; primary?: boolean }>;
			};
			const items = data.items ?? [];
			if (items.length === 0)
				return {
					content: [{ type: "text" as const, text: "No calendars found." }],
				};
			const lines = [`Successfully listed ${items.length} calendar(s):`];
			for (const cal of items) {
				lines.push(
					`- "${cal.summary ?? "No Summary"}"${cal.primary ? " (Primary)" : ""} (ID: ${cal.id})`,
				);
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 2. get_events ──────────────────────────────────────────────────────────
	server.tool(
		"get_events",
		"Retrieve Google Calendar events by event ID or time range. Supports keyword search and detailed output.",
		{
			calendar_id: z
				.string()
				.default("primary")
				.describe("Calendar ID; 'primary' for the main calendar."),
			event_id: z
				.string()
				.optional()
				.describe("Specific event ID. If set, ignores time-range params."),
			time_min: z
				.string()
				.optional()
				.describe("Start of range in RFC3339 or YYYY-MM-DD. Defaults to now."),
			time_max: z
				.string()
				.optional()
				.describe("End of range (exclusive) in RFC3339 or YYYY-MM-DD."),
			max_results: z
				.number()
				.int()
				.default(25)
				.describe("Max events to return (default 25)."),
			query: z
				.string()
				.optional()
				.describe("Keyword search over event summary/description/location."),
			detailed: z
				.boolean()
				.default(false)
				.describe(
					"Return full event details including attendees and description.",
				),
			include_attachments: z
				.boolean()
				.default(false)
				.describe("Include attachment info (only when detailed=true)."),
		},
		async ({
			calendar_id,
			event_id,
			time_min,
			time_max,
			max_results,
			query,
			detailed,
			include_attachments,
		}) => {
			const { accessToken } = await ctx.getService("gcalendar");

			let items: EventRecord[];
			if (event_id) {
				const ev = (await calFetch(
					accessToken,
					`${CAL_BASE}/calendars/${encodeURIComponent(calendar_id)}/events/${encodeURIComponent(event_id)}`,
				)) as EventRecord;
				items = [ev];
			} else {
				let effectiveTimeMin = correctTimeForApi(time_min, "time_min");
				if (!effectiveTimeMin) effectiveTimeMin = new Date().toISOString();
				const effectiveTimeMax = correctTimeForApi(time_max, "time_max");
				const url = buildUrl(
					`${CAL_BASE}/calendars/${encodeURIComponent(calendar_id)}/events`,
					{
						timeMin: effectiveTimeMin,
						timeMax: effectiveTimeMax,
						maxResults: max_results,
						singleEvents: true,
						orderBy: "startTime",
						q: query,
					},
				);
				const result = (await calFetch(accessToken, url)) as EventsListResponse;
				items = result.items ?? [];
			}

			if (items.length === 0) {
				const msg = event_id
					? `Event with ID '${event_id}' not found in calendar '${calendar_id}'.`
					: `No events found in calendar '${calendar_id}' for the specified time range.`;
				return { content: [{ type: "text" as const, text: msg }] };
			}

			// Single event + detailed
			if (event_id && detailed) {
				const item = items[0];
				const attendees = (item.attendees ?? []) as Array<
					Record<string, unknown>
				>;
				const meetLink = getMeetingLink(item as Record<string, unknown>);
				const parts = [
					"Event Details:",
					`- Title: ${item.summary ?? "No Title"}`,
					`- Starts: ${item.start?.dateTime ?? item.start?.date ?? "N/A"}`,
					`- Ends: ${item.end?.dateTime ?? item.end?.date ?? "N/A"}`,
					`- Description: ${item.description ?? "No Description"}`,
					`- Location: ${item.location ?? "No Location"}`,
					`- Color ID: ${item.colorId ?? "None"}`,
				];
				const creatorStr = formatPerson(
					item.creator as Record<string, unknown> | undefined,
				);
				const organizerStr = formatPerson(
					item.organizer as Record<string, unknown> | undefined,
				);
				if (creatorStr) parts.push(`- Creator: ${creatorStr}`);
				if (organizerStr) parts.push(`- Organizer: ${organizerStr}`);
				if (meetLink) parts.push(`- Meeting Link: ${meetLink}`);
				parts.push(
					`- Attendees: ${attendees.map((a) => a.email).join(", ") || "None"}`,
					`- Attendee Details: ${formatAttendeeDetails(attendees, "  ")}`,
				);
				if (include_attachments) {
					parts.push(
						`- Attachments: ${formatAttachmentDetails((item.attachments ?? []) as Array<Record<string, unknown>>, "  ")}`,
					);
				}
				parts.push(
					`- Event ID: ${event_id}`,
					`- Link: ${item.htmlLink ?? "No Link"}`,
				);
				return {
					content: [{ type: "text" as const, text: parts.join("\n") }],
				};
			}

			// List output (basic or detailed)
			const eventLines: string[] = [];
			for (const item of items) {
				const startTime = item.start?.dateTime ?? item.start?.date ?? "N/A";
				const endTime = item.end?.dateTime ?? item.end?.date ?? "N/A";
				const itemId = item.id ?? "No ID";
				const link = item.htmlLink ?? "No Link";

				if (detailed) {
					const attendees = (item.attendees ?? []) as Array<
						Record<string, unknown>
					>;
					const meetLink = getMeetingLink(item as Record<string, unknown>);
					const creatorStr = formatPerson(
						item.creator as Record<string, unknown> | undefined,
					);
					const organizerStr = formatPerson(
						item.organizer as Record<string, unknown> | undefined,
					);
					const parts = [
						`- "${item.summary ?? "No Title"}" (Starts: ${startTime}, Ends: ${endTime})`,
						`  Description: ${item.description ?? "No Description"}`,
						`  Location: ${item.location ?? "No Location"}`,
					];
					if (creatorStr) parts.push(`  Creator: ${creatorStr}`);
					if (organizerStr) parts.push(`  Organizer: ${organizerStr}`);
					if (meetLink) parts.push(`  Meeting Link: ${meetLink}`);
					parts.push(
						`  Attendees: ${attendees.map((a) => a.email).join(", ") || "None"}`,
						`  Attendee Details: ${formatAttendeeDetails(attendees, "    ")}`,
					);
					if (include_attachments) {
						parts.push(
							`  Attachments: ${formatAttachmentDetails((item.attachments ?? []) as Array<Record<string, unknown>>, "    ")}`,
						);
					}
					parts.push(`  ID: ${itemId} | Link: ${link}`);
					eventLines.push(parts.join("\n"));
				} else {
					const meetLink = getMeetingLink(item as Record<string, unknown>);
					let line = `- "${item.summary ?? "No Title"}" (Starts: ${startTime}, Ends: ${endTime})`;
					if (meetLink) line += ` Meeting: ${meetLink}`;
					line += ` ID: ${itemId} | Link: ${link}`;
					eventLines.push(line);
				}
			}

			const header = event_id
				? `Successfully retrieved event from calendar '${calendar_id}':`
				: `Successfully retrieved ${items.length} event(s) from calendar '${calendar_id}':`;
			return {
				content: [
					{
						type: "text" as const,
						text: `${header}\n${eventLines.join("\n")}`,
					},
				],
			};
		},
	);

	// ── 3. manage_event ────────────────────────────────────────────────────────
	server.tool(
		"manage_event",
		"Create, update, delete, or RSVP to a Google Calendar event.",
		{
			action: z.string().describe('"create", "update", "delete", or "rsvp".'),
			summary: z
				.string()
				.optional()
				.describe("Event title (required for create)."),
			start_time: z
				.string()
				.optional()
				.describe("Start time in RFC3339 format (required for create)."),
			end_time: z
				.string()
				.optional()
				.describe("End time in RFC3339 format (required for create)."),
			event_id: z
				.string()
				.optional()
				.describe("Event ID (required for update, delete, rsvp)."),
			calendar_id: z.string().default("primary").describe("Calendar ID."),
			description: z.string().optional().describe("Event description."),
			location: z.string().optional().describe("Event location."),
			attendees: z
				.array(
					z.union([z.string(), z.object({ email: z.string() }).passthrough()]),
				)
				.optional()
				.describe("Attendee emails or objects with at least an email field."),
			timezone: z
				.string()
				.optional()
				.describe(
					"IANA timezone (e.g. 'America/New_York'). Strips UTC offset so Google resolves DST correctly.",
				),
			attachments: z
				.array(z.string())
				.optional()
				.describe("Google Drive file IDs or URLs to attach."),
			add_google_meet: z
				.boolean()
				.optional()
				.describe(
					"true = add native Google Meet; false = remove Meet (update only). Mutually exclusive with conference_provider.",
				),
			conference_data: z
				.record(z.string(), z.unknown())
				.optional()
				.describe(
					"Raw Google Calendar conferenceData payload for a third-party conference. Mutually exclusive with conference_provider params.",
				),
			conference_provider: z
				.string()
				.optional()
				.describe(
					'Third-party provider name (e.g. "zoom", "webex", "teams"). Requires conference_uri.',
				),
			conference_uri: z
				.string()
				.optional()
				.describe("Join URL for the third-party conference."),
			conference_passcode: z
				.string()
				.optional()
				.describe("Optional passcode for the conference."),
			conference_id: z
				.string()
				.optional()
				.describe("Optional provider-side conference/meeting ID."),
			reminders: z
				.union([
					z.string(),
					z.array(z.object({ method: z.string(), minutes: z.number() })),
				])
				.optional()
				.describe(
					'Custom reminder objects e.g. [{"method":"popup","minutes":10}].',
				),
			use_default_reminders: z
				.boolean()
				.optional()
				.describe(
					"Use default reminders. Defaults to true on create; preserved from existing on update.",
				),
			transparency: z
				.string()
				.optional()
				.describe('"opaque" (busy) or "transparent" (free).'),
			visibility: z
				.string()
				.optional()
				.describe('"default", "public", "private", or "confidential".'),
			color_id: z
				.string()
				.optional()
				.describe("Event color ID 1–11 (update only)."),
			recurrence: z
				.array(z.string())
				.optional()
				.describe(
					'RFC5545 recurrence rules e.g. ["RRULE:FREQ=WEEKLY;COUNT=10"].',
				),
			guests_can_modify: z.boolean().optional(),
			guests_can_invite_others: z.boolean().optional(),
			guests_can_see_other_guests: z.boolean().optional(),
			response: z
				.string()
				.optional()
				.describe(
					'RSVP response: "accepted", "declined", "tentative", or "needsAction".',
				),
			rsvp_comment: z
				.string()
				.optional()
				.describe("Optional message to include with the RSVP response."),
			send_updates: z
				.string()
				.optional()
				.describe('"all" (default), "externalOnly", or "none".'),
		},
		async (p) => {
			const { accessToken } = await ctx.getService("gcalendar");
			const action = p.action.toLowerCase().trim();

			if (p.send_updates !== undefined) {
				const validSU = new Set(["all", "externalOnly", "none"]);
				if (!validSU.has(p.send_updates))
					throw new Error(
						`Invalid send_updates '${p.send_updates}'. Must be one of: ${[...validSU].sort().join(", ")}`,
					);
			}

			let resolvedConference: Record<string, unknown> | null = null;
			if (action === "create" || action === "update") {
				resolvedConference = resolveConferenceData(
					p.conference_data ?? null,
					p.conference_provider,
					p.conference_uri,
					p.conference_passcode,
					p.conference_id,
					p.add_google_meet,
				);
			}

			let text: string;
			if (action === "create") {
				if (!p.summary || !p.start_time || !p.end_time)
					throw new Error(
						"summary, start_time, and end_time are required for create.",
					);
				text = await createEventImpl(accessToken, {
					summary: p.summary,
					startTime: p.start_time,
					endTime: p.end_time,
					calendarId: p.calendar_id,
					description: p.description,
					location: p.location,
					attendees: p.attendees as AttendeeInput[] | undefined,
					timezone: p.timezone,
					attachments: p.attachments,
					addGoogleMeet: p.add_google_meet ?? false,
					conferenceData: resolvedConference,
					reminders: p.reminders as string | ReminderObj[] | undefined,
					useDefaultReminders: p.use_default_reminders ?? true,
					transparency: p.transparency,
					visibility: p.visibility,
					recurrence: p.recurrence,
					guestsCanModify: p.guests_can_modify,
					guestsCanInviteOthers: p.guests_can_invite_others,
					guestsCanSeeOtherGuests: p.guests_can_see_other_guests,
					sendUpdates: p.send_updates ?? "all",
				});
			} else if (action === "update") {
				if (!p.event_id) throw new Error("event_id is required for update.");
				text = await modifyEventImpl(accessToken, {
					eventId: p.event_id,
					calendarId: p.calendar_id,
					summary: p.summary,
					startTime: p.start_time,
					endTime: p.end_time,
					description: p.description,
					location: p.location,
					attendees: p.attendees as AttendeeInput[] | undefined,
					timezone: p.timezone,
					addGoogleMeet: p.add_google_meet,
					conferenceData: resolvedConference,
					reminders: p.reminders as string | ReminderObj[] | undefined,
					useDefaultReminders: p.use_default_reminders,
					transparency: p.transparency,
					visibility: p.visibility,
					colorId: p.color_id,
					recurrence: p.recurrence,
					guestsCanModify: p.guests_can_modify,
					guestsCanInviteOthers: p.guests_can_invite_others,
					guestsCanSeeOtherGuests: p.guests_can_see_other_guests,
					sendUpdates: p.send_updates ?? "all",
				});
			} else if (action === "delete") {
				if (!p.event_id) throw new Error("event_id is required for delete.");
				text = await deleteEventImpl(
					accessToken,
					p.event_id,
					p.calendar_id,
					p.send_updates ?? "all",
				);
			} else if (action === "rsvp") {
				if (!p.event_id) throw new Error("event_id is required for rsvp.");
				if (!p.response) throw new Error("response is required for rsvp.");
				text = await rsvpEventImpl(
					accessToken,
					p.event_id,
					p.response,
					p.calendar_id,
					p.rsvp_comment,
					p.send_updates ?? "all",
				);
			} else {
				throw new Error(
					`Invalid action '${action}'. Must be 'create', 'update', 'delete', or 'rsvp'.`,
				);
			}
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 4. manage_out_of_office ────────────────────────────────────────────────
	server.tool(
		"manage_out_of_office",
		"Create, list, update, or delete Out of Office events on Google Calendar. These events auto-decline conflicting invitations.",
		{
			action: z.string().describe('"create", "list", "update", or "delete".'),
			start_time: z
				.string()
				.optional()
				.describe(
					"Start date/time (YYYY-MM-DD or RFC3339). Required for create.",
				),
			end_time: z
				.string()
				.optional()
				.describe("End date/time (exclusive). Required for create."),
			summary: z
				.string()
				.optional()
				.describe('Display text. Defaults to "Out of Office".'),
			auto_decline_mode: z
				.string()
				.optional()
				.describe(
					'"declineAllConflictingInvitations" (default), "declineOnlyNewConflictingInvitations", or "declineNone".',
				),
			decline_message: z
				.string()
				.optional()
				.describe("Message sent when auto-declining invitations."),
			recurrence: z
				.array(z.string())
				.optional()
				.describe("RFC5545 recurrence rules."),
			timezone: z
				.string()
				.optional()
				.describe(
					"IANA timezone. Required when using date-only values or dateTime without explicit UTC offset.",
				),
			time_min: z
				.string()
				.optional()
				.describe("For list: start of range. Defaults to now."),
			time_max: z.string().optional().describe("For list: end of range."),
			max_results: z
				.number()
				.int()
				.default(10)
				.describe("For list: max events to return."),
			event_id: z
				.string()
				.optional()
				.describe("Event ID. Required for update and delete."),
			calendar_id: z.string().default("primary").describe("Calendar ID."),
		},
		async (p) => {
			const { accessToken } = await ctx.getService("gcalendar");
			const action = p.action.toLowerCase().trim();
			let text: string;

			if (action === "create") {
				if (!p.start_time || !p.end_time)
					throw new Error("start_time and end_time are required for create.");
				text = await createOooEventImpl(accessToken, {
					startTime: p.start_time,
					endTime: p.end_time,
					calendarId: p.calendar_id,
					summary: p.summary,
					autoDeclineMode: p.auto_decline_mode,
					declineMessage: p.decline_message,
					recurrence: p.recurrence,
					timezone: p.timezone,
				});
			} else if (action === "list") {
				text = await listOooEventsImpl(
					accessToken,
					p.calendar_id,
					p.time_min,
					p.time_max,
					p.max_results,
					p.timezone,
				);
			} else if (action === "update") {
				if (!p.event_id) throw new Error("event_id is required for update.");
				text = await updateOooEventImpl(
					accessToken,
					p.event_id,
					p.calendar_id,
					p.start_time,
					p.end_time,
					p.summary,
					p.auto_decline_mode,
					p.decline_message,
					p.recurrence,
					p.timezone,
				);
			} else if (action === "delete") {
				if (!p.event_id) throw new Error("event_id is required for delete.");
				text = await deleteOooEventImpl(accessToken, p.event_id, p.calendar_id);
			} else {
				throw new Error(
					`Invalid action '${action}'. Must be 'create', 'list', 'update', or 'delete'.`,
				);
			}
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 5. manage_focus_time ───────────────────────────────────────────────────
	server.tool(
		"manage_focus_time",
		"Create, list, update, or delete Focus Time events on Google Calendar. These events protect blocks of uninterrupted work time.",
		{
			action: z.string().describe('"create", "list", "update", or "delete".'),
			start_time: z
				.string()
				.optional()
				.describe(
					"Start date/time (YYYY-MM-DD or RFC3339). Required for create.",
				),
			end_time: z
				.string()
				.optional()
				.describe("End date/time (exclusive). Required for create."),
			summary: z
				.string()
				.optional()
				.describe('Display text. Defaults to "Focus Time".'),
			description: z.string().optional().describe("Event description."),
			auto_decline_mode: z
				.string()
				.optional()
				.describe(
					'"declineAllConflictingInvitations" (default), "declineOnlyNewConflictingInvitations", or "declineNone".',
				),
			decline_message: z
				.string()
				.optional()
				.describe("Message sent when auto-declining invitations."),
			chat_status: z
				.string()
				.optional()
				.describe('"doNotDisturb" (default) or "available".'),
			recurrence: z
				.array(z.string())
				.optional()
				.describe("RFC5545 recurrence rules."),
			timezone: z
				.string()
				.optional()
				.describe(
					"IANA timezone. Required when using date-only values or dateTime without explicit UTC offset.",
				),
			time_min: z
				.string()
				.optional()
				.describe("For list: start of range. Defaults to now."),
			time_max: z.string().optional().describe("For list: end of range."),
			max_results: z
				.number()
				.int()
				.default(10)
				.describe("For list: max events to return."),
			event_id: z
				.string()
				.optional()
				.describe("Event ID. Required for update and delete."),
			calendar_id: z.string().default("primary").describe("Calendar ID."),
		},
		async (p) => {
			const { accessToken } = await ctx.getService("gcalendar");
			const action = p.action.toLowerCase().trim();
			let text: string;

			if (action === "create") {
				if (!p.start_time || !p.end_time)
					throw new Error("start_time and end_time are required for create.");
				text = await createFocusTimeEventImpl(accessToken, {
					startTime: p.start_time,
					endTime: p.end_time,
					calendarId: p.calendar_id,
					summary: p.summary,
					description: p.description,
					autoDeclineMode: p.auto_decline_mode,
					declineMessage: p.decline_message,
					chatStatus: p.chat_status,
					recurrence: p.recurrence,
					timezone: p.timezone,
				});
			} else if (action === "list") {
				text = await listFocusTimeEventsImpl(
					accessToken,
					p.calendar_id,
					p.time_min,
					p.time_max,
					p.max_results,
					p.timezone,
				);
			} else if (action === "update") {
				if (!p.event_id) throw new Error("event_id is required for update.");
				text = await updateFocusTimeEventImpl(
					accessToken,
					p.event_id,
					p.calendar_id,
					p.start_time,
					p.end_time,
					p.summary,
					p.description,
					p.auto_decline_mode,
					p.decline_message,
					p.chat_status,
					p.recurrence,
					p.timezone,
				);
			} else if (action === "delete") {
				if (!p.event_id) throw new Error("event_id is required for delete.");
				text = await deleteFocusTimeEventImpl(
					accessToken,
					p.event_id,
					p.calendar_id,
				);
			} else {
				throw new Error(
					`Invalid action '${action}'. Must be 'create', 'list', 'update', or 'delete'.`,
				);
			}
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 6. query_freebusy ─────────────────────────────────────────────────────
	server.tool(
		"query_freebusy",
		"Query free/busy information for a set of Google Calendars.",
		{
			time_min: z
				.string()
				.describe("Start of interval in RFC3339 or YYYY-MM-DD format."),
			time_max: z
				.string()
				.describe("End of interval in RFC3339 or YYYY-MM-DD format."),
			calendar_ids: z
				.array(z.string())
				.optional()
				.describe("Calendar IDs to query. Defaults to ['primary']."),
			group_expansion_max: z
				.number()
				.int()
				.optional()
				.describe("Max calendar identifiers per group (max 100)."),
			calendar_expansion_max: z
				.number()
				.int()
				.optional()
				.describe("Max calendars for FreeBusy info (max 50)."),
		},
		async ({
			time_min,
			time_max,
			calendar_ids,
			group_expansion_max,
			calendar_expansion_max,
		}) => {
			const { accessToken } = await ctx.getService("gcalendar");

			const formattedMin = correctTimeForApi(time_min, "time_min") ?? time_min;
			const formattedMax = correctTimeForApi(time_max, "time_max") ?? time_max;
			const calIds =
				calendar_ids && calendar_ids.length > 0 ? calendar_ids : ["primary"];

			const reqBody: Record<string, unknown> = {
				timeMin: formattedMin,
				timeMax: formattedMax,
				items: calIds.map((id) => ({ id })),
			};
			if (group_expansion_max !== undefined)
				reqBody.groupExpansionMax = group_expansion_max;
			if (calendar_expansion_max !== undefined)
				reqBody.calendarExpansionMax = calendar_expansion_max;

			const result = (await calFetch(accessToken, `${CAL_BASE}/freeBusy`, {
				method: "POST",
				body: JSON.stringify(reqBody),
			})) as {
				timeMin?: string;
				timeMax?: string;
				calendars?: Record<
					string,
					{
						errors?: Array<{ domain?: string; reason?: string }>;
						busy?: Array<{ start?: string; end?: string }>;
					}
				>;
			};

			const calendars = result.calendars ?? {};
			if (Object.keys(calendars).length === 0)
				return {
					content: [
						{
							type: "text" as const,
							text: "No free/busy information found for the requested calendars.",
						},
					],
				};

			const lines = [
				"Free/Busy information:",
				`Time range: ${result.timeMin ?? formattedMin} to ${result.timeMax ?? formattedMax}`,
				"",
			];
			for (const [calId, calData] of Object.entries(calendars)) {
				lines.push(`Calendar: ${calId}`);
				if (calData.errors && calData.errors.length > 0) {
					lines.push("  Errors:");
					for (const err of calData.errors)
						lines.push(
							`    - ${err.domain ?? "unknown"}: ${err.reason ?? "unknown"}`,
						);
					lines.push("");
					continue;
				}
				const busy = calData.busy ?? [];
				if (busy.length === 0) {
					lines.push("  Status: Free (no busy periods)");
				} else {
					lines.push(`  Busy periods: ${busy.length}`);
					for (const period of busy)
						lines.push(`    - ${period.start ?? "?"} to ${period.end ?? "?"}`);
				}
				lines.push("");
			}
			return {
				content: [
					{
						type: "text" as const,
						text: lines.join("\n").trimEnd(),
					},
				],
			};
		},
	);

	// ── 7. create_calendar ────────────────────────────────────────────────────
	server.tool(
		"create_calendar",
		"Create a new secondary Google Calendar.",
		{
			summary: z.string().describe("Title/name of the new calendar."),
			description: z.string().optional().describe("Optional description."),
			timezone: z
				.string()
				.optional()
				.describe("IANA timezone (e.g. 'America/New_York')."),
		},
		async ({ summary, description, timezone }) => {
			const { accessToken } = await ctx.getService("gcalendar");
			const body: Record<string, unknown> = { summary };
			if (description) body.description = description;
			if (timezone) body.timeZone = timezone;

			const result = (await calFetch(accessToken, `${CAL_BASE}/calendars`, {
				method: "POST",
				body: JSON.stringify(body),
			})) as { id?: string; summary?: string };

			return {
				content: [
					{
						type: "text" as const,
						text: `Created calendar '${result.summary ?? summary}' (ID: ${result.id ?? "N/A"})`,
					},
				],
			};
		},
	);
}
