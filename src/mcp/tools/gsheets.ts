// Google Sheets tools — 14 tools for the `gsheets` service.
// API bases:
//   Sheets v4: https://sheets.googleapis.com/v4
//   Drive v3:  https://www.googleapis.com/drive/v3 (list + comments)

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { googleApiFetch, type ToolContext } from "../google-service";

// ─── Constants ─────────────────────────────────────────────────────────────────

const SHEETS_BASE = "https://sheets.googleapis.com/v4";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const MAX_GRID_METADATA_CELLS = 5000;

// ─── Fetch alias ───────────────────────────────────────────────────────────────

const sheetsFetch = googleApiFetch;

// ─── URL builder ───────────────────────────────────────────────────────────────

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

// ─── Response interfaces ───────────────────────────────────────────────────────

interface ColorObj {
	red?: number;
	green?: number;
	blue?: number;
}

interface GridRange {
	sheetId?: number;
	startRowIndex?: number;
	endRowIndex?: number;
	startColumnIndex?: number;
	endColumnIndex?: number;
}

interface SheetGridProps {
	rowCount?: number;
	columnCount?: number;
	frozenRowCount?: number;
	frozenColumnCount?: number;
}

interface ConditionalRule {
	ranges?: GridRange[];
	booleanRule?: {
		condition?: {
			type?: string;
			values?: Array<{ userEnteredValue?: string }>;
		};
		format?: {
			backgroundColor?: ColorObj;
			textFormat?: { foregroundColor?: ColorObj };
		};
	};
	gradientRule?: {
		minpoint?: GradientPointData;
		midpoint?: GradientPointData;
		maxpoint?: GradientPointData;
	};
}

interface GradientPointData {
	type?: string;
	color?: ColorObj;
	value?: string;
}

interface SheetData {
	properties?: {
		sheetId?: number;
		title?: string;
		index?: number;
		gridProperties?: SheetGridProps;
	};
	conditionalFormats?: ConditionalRule[];
	tables?: Array<{
		tableId?: string;
		name?: string;
		range?: GridRange;
		columnProperties?: Array<{ columnName?: string }>;
	}>;
}

interface SpreadsheetResponse {
	spreadsheetId?: string;
	spreadsheetUrl?: string;
	properties?: { title?: string; locale?: string };
	sheets?: SheetData[];
}

interface ValueRangeResponse {
	range?: string;
	values?: unknown[][];
}

interface UpdateValuesResponse {
	updatedCells?: number;
	updatedRows?: number;
	updatedColumns?: number;
	updatedRange?: string;
	updatedData?: { values?: unknown[][] };
}

interface ClearValuesResponse {
	clearedRange?: string;
}

interface DriveFilesResponse {
	files?: Array<{
		id?: string;
		name?: string;
		modifiedTime?: string;
		webViewLink?: string;
	}>;
}

interface DriveComment {
	id?: string;
	content?: string;
	author?: { displayName?: string };
	createdTime?: string;
	resolved?: boolean;
	quotedFileContent?: { value?: string };
	replies?: Array<{
		id?: string;
		content?: string;
		author?: { displayName?: string };
		createdTime?: string;
	}>;
}

interface DriveCommentsResponse {
	comments?: DriveComment[];
	nextPageToken?: string;
}

// Grid-data interfaces for hyperlinks / notes / errors
interface GridCellData {
	effectiveValue?: { errorValue?: { type?: string; message?: string } };
	hyperlink?: string;
	textFormatRuns?: Array<{ format?: { link?: { uri?: string } } }>;
	note?: string;
}

interface GridDataBlock {
	startRow?: number;
	startColumn?: number;
	rowData?: Array<{ values?: GridCellData[] }>;
}

interface SheetWithGridData {
	properties?: { title?: string };
	data?: GridDataBlock[];
}

interface SpreadsheetWithGrid {
	sheets?: SheetWithGridData[];
}

// ─── Column / A1 helpers ───────────────────────────────────────────────────────

/** Convert column letters (A, B, AA) to zero-based index. Returns null for empty. */
function columnToIndex(column: string): number | null {
	if (!column) return null;
	let result = 0;
	for (const char of column.toUpperCase()) {
		result = result * 26 + (char.charCodeAt(0) - 65 + 1);
	}
	return result - 1;
}

/** Convert zero-based column index to column letters (0→A, 25→Z, 26→AA). */
function indexToColumn(index: number): string {
	if (index < 0)
		throw new Error(`Column index must be non-negative, got ${index}.`);
	const result: string[] = [];
	let n = index + 1;
	while (n > 0) {
		const rem = (n - 1) % 26;
		result.push(String.fromCharCode(65 + rem));
		n = Math.floor((n - 1) / 26);
	}
	return result.reverse().join("");
}

const A1_PART_RE = /^([A-Za-z]*)(\d*)$/;
const SHEET_TITLE_SAFE_RE = /^[A-Za-z0-9_]+$/;

/** Parse a single A1 cell part into [colIndex, rowIndex] (zero-based). */
function parseA1Part(part: string): [number | null, number | null] {
	const clean = part.replace(/\$/g, "");
	const m = A1_PART_RE.exec(clean);
	if (!m) throw new Error(`Invalid A1 range part: '${part}'.`);
	const [, colLetters, rowDigits] = m;
	const colIdx = colLetters ? columnToIndex(colLetters) : null;
	const rowIdx = rowDigits ? parseInt(rowDigits, 10) - 1 : null;
	return [colIdx, rowIdx];
}

/** Split "Sheet1!A1:B2" → ["Sheet1", "A1:B2"]. Handles quoted sheet names. */
function splitSheetAndRange(rangeName: string): [string | null, string] {
	if (!rangeName.includes("!")) return [null, rangeName];
	if (rangeName.startsWith("'")) {
		const closing = rangeName.indexOf("'!");
		if (closing !== -1) {
			const sheetName = rangeName.slice(1, closing).replace(/''/g, "'");
			return [sheetName, rangeName.slice(closing + 2)];
		}
	}
	const idx = rangeName.indexOf("!");
	return [
		rangeName.slice(0, idx).trim().replace(/^'|'$/g, ""),
		rangeName.slice(idx + 1),
	];
}

/** Quote a sheet title for A1 notation if it contains special characters. */
function quoteSheetTitle(title: string): string {
	if (SHEET_TITLE_SAFE_RE.test(title ?? "")) return title;
	return `'${(title ?? "").replace(/'/g, "''")}'`;
}

/** Format a cell reference in A1 notation (zero-based row + col). */
function formatA1Cell(
	sheetTitle: string,
	rowIndex: number,
	colIndex: number,
): string {
	return `${quoteSheetTitle(sheetTitle)}!${indexToColumn(colIndex)}${rowIndex + 1}`;
}

/** Convert an A1-style range (with optional sheet name) into a GridRange. */
function parseA1Range(rangeName: string, sheets: SheetData[]): GridRange {
	const [sheetName, a1Range] = splitSheetAndRange(rangeName);
	if (!sheets.length) throw new Error("Spreadsheet has no sheets.");

	let target: SheetData | undefined;
	if (sheetName) {
		target = sheets.find((s) => s.properties?.title === sheetName);
		if (!target) {
			const avail = sheets
				.map((s) => s.properties?.title ?? "Untitled")
				.join(", ");
			throw new Error(
				`Sheet '${sheetName}' not found in spreadsheet. Available sheets: ${avail}.`,
			);
		}
	} else {
		target = sheets[0];
	}

	if (!a1Range)
		throw new Error("A1-style range must not be empty (e.g., 'A1', 'A1:B10').");

	const parts = a1Range.includes(":")
		? a1Range.split(":", 2)
		: [a1Range, a1Range];
	const [startCol, startRow] = parseA1Part(parts[0]);
	const [endCol, endRow] = parseA1Part(parts[1]);

	const gr: GridRange = { sheetId: target.properties?.sheetId };
	if (startRow !== null) gr.startRowIndex = startRow;
	if (startCol !== null) gr.startColumnIndex = startCol;
	if (endRow !== null) gr.endRowIndex = endRow + 1;
	if (endCol !== null) gr.endColumnIndex = endCol + 1;
	return gr;
}

/** Select a sheet by name, or the first sheet if name is not given. */
function selectSheet(
	sheets: SheetData[],
	sheetName: string | null | undefined,
): SheetData {
	if (!sheets.length) throw new Error("Spreadsheet has no sheets.");
	if (!sheetName) return sheets[0];
	const found = sheets.find((s) => s.properties?.title === sheetName);
	if (!found) {
		const avail = sheets
			.map((s) => s.properties?.title ?? "Untitled")
			.join(", ");
		throw new Error(
			`Sheet '${sheetName}' not found. Available sheets: ${avail}.`,
		);
	}
	return found;
}

// ─── Color helpers ─────────────────────────────────────────────────────────────

function parseHexColor(color: string | null | undefined): ColorObj | null {
	if (!color) return null;
	let t = color.trim();
	if (t.startsWith("#")) t = t.slice(1);
	if (t.length !== 6)
		throw new Error(`Color '${color}' must be in format #RRGGBB or RRGGBB.`);
	const r = parseInt(t.slice(0, 2), 16);
	const g = parseInt(t.slice(2, 4), 16);
	const b = parseInt(t.slice(4, 6), 16);
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b))
		throw new Error(`Color '${color}' is not valid hex.`);
	return { red: r / 255, green: g / 255, blue: b / 255 };
}

function colorToHex(color: ColorObj | null | undefined): string | null {
	if (!color) return null;
	const clamp = (v: number | undefined) =>
		Math.max(0, Math.min(255, Math.round((v ?? 0) * 255)));
	const r = clamp(color.red);
	const g = clamp(color.green);
	const b = clamp(color.blue);
	return `#${r.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}`;
}

// ─── Sheets error token detection ─────────────────────────────────────────────

function isSheetErrorToken(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const c = value.trim();
	if (!c.startsWith("#")) return false;
	const u = c.toUpperCase();
	if (u === "#N/A") return true;
	return u.endsWith("!") || u.endsWith("?");
}

function valuesContainSheetsErrors(values: unknown[][]): boolean {
	for (const row of values)
		for (const cell of row) if (isSheetErrorToken(cell)) return true;
	return false;
}

// ─── A1 range helpers ─────────────────────────────────────────────────────────

function a1RangeForValues(a1Range: string, values: unknown[][]): string | null {
	const [sheetName, rangePart] = splitSheetAndRange(a1Range);
	if (!rangePart) return null;
	let startCol: number | null;
	let startRow: number | null;
	try {
		[startCol, startRow] = parseA1Part(rangePart.split(":")[0]);
	} catch {
		return null;
	}
	if (startCol === null || startRow === null) return null;
	const height = values.length;
	const width = Math.max(...values.map((r) => (r as unknown[]).length), 0);
	if (height <= 0 || width <= 0) return null;
	const endRow = startRow + height - 1;
	const endCol = startCol + width - 1;
	const startLabel = `${indexToColumn(startCol)}${startRow + 1}`;
	const endLabel = `${indexToColumn(endCol)}${endRow + 1}`;
	const rangeRef =
		startLabel === endLabel ? startLabel : `${startLabel}:${endLabel}`;
	return sheetName ? `${quoteSheetTitle(sheetName)}!${rangeRef}` : rangeRef;
}

function a1RangeCellCount(a1Range: string): number | null {
	const [, rangePart] = splitSheetAndRange(a1Range);
	if (!rangePart) return null;
	const parts = rangePart.includes(":")
		? rangePart.split(":", 2)
		: [rangePart, rangePart];
	try {
		const [sc, sr] = parseA1Part(parts[0]);
		const [ec, er] = parseA1Part(parts[1]);
		if (sc === null || sr === null || ec === null || er === null) return null;
		if (ec < sc || er < sr) return null;
		return (ec - sc + 1) * (er - sr + 1);
	} catch {
		return null;
	}
}

// ─── GridRange → A1 ───────────────────────────────────────────────────────────

function gridRangeToA1(
	gr: GridRange,
	sheetTitles: Map<number, string>,
): string {
	const sid = gr.sheetId ?? 0;
	const title = sheetTitles.get(sid) ?? `Sheet ${sid}`;
	const {
		startRowIndex: sr,
		endRowIndex: er,
		startColumnIndex: sc,
		endColumnIndex: ec,
	} = gr;
	if (
		sr === undefined &&
		er === undefined &&
		sc === undefined &&
		ec === undefined
	)
		return title;
	const rowLbl = (i: number | undefined) =>
		i !== undefined ? String(i + 1) : "";
	const colLbl = (i: number | undefined) =>
		i !== undefined ? indexToColumn(i) : "";
	const startLabel = `${colLbl(sc)}${rowLbl(sr)}`;
	const endLabel = `${colLbl(ec !== undefined ? ec - 1 : undefined)}${rowLbl(er !== undefined ? er - 1 : undefined)}`;
	let rangeRef: string;
	if (startLabel && endLabel) {
		rangeRef =
			startLabel === endLabel ? startLabel : `${startLabel}:${endLabel}`;
	} else {
		rangeRef = startLabel || endLabel;
	}
	return rangeRef ? `${title}!${rangeRef}` : title;
}

// ─── Conditional format formatting ────────────────────────────────────────────

function summarizeConditionalRule(
	rule: ConditionalRule,
	index: number,
	sheetTitles: Map<number, string>,
): string {
	const rangePart =
		(rule.ranges ?? []).map((r) => gridRangeToA1(r, sheetTitles)).join(", ") ||
		"(no range)";

	if (rule.booleanRule) {
		const cond = rule.booleanRule.condition ?? {};
		const condType = cond.type ?? "UNKNOWN";
		const vals = (cond.values ?? [])
			.filter((v) => v.userEnteredValue !== undefined)
			.map((v) => v.userEnteredValue);
		const valueDesc = vals.length ? ` values=${JSON.stringify(vals)}` : "";
		const fmt = rule.booleanRule.format ?? {};
		const fmtParts: string[] = [];
		const bgHex = colorToHex(fmt.backgroundColor);
		if (bgHex) fmtParts.push(`bg ${bgHex}`);
		const fgHex = colorToHex(fmt.textFormat?.foregroundColor);
		if (fgHex) fmtParts.push(`text ${fgHex}`);
		return `[${index}] ${condType}${valueDesc} -> ${fmtParts.join(", ") || "no format"} on ${rangePart}`;
	}

	if (rule.gradientRule) {
		const gr = rule.gradientRule;
		const points: string[] = [];
		for (const [name, pt] of [
			["minpoint", gr.minpoint],
			["midpoint", gr.midpoint],
			["maxpoint", gr.maxpoint],
		] as [string, GradientPointData | undefined][]) {
			if (!pt) continue;
			const hex = colorToHex(pt.color);
			let desc = pt.type ?? name;
			if (pt.value) desc += `:${pt.value}`;
			if (hex) desc += ` ${hex}`;
			points.push(desc);
		}
		return `[${index}] gradient -> ${points.join(" | ") || "gradient"} on ${rangePart}`;
	}

	return `[${index}] (unknown rule) on ${rangePart}`;
}

function formatConditionalRulesSection(
	sheetTitle: string,
	rules: ConditionalRule[],
	sheetTitles: Map<number, string>,
	indent = "  ",
): string {
	if (!rules.length)
		return `${indent}Conditional formats for "${sheetTitle}": none.`;
	const lines = [
		`${indent}Conditional formats for "${sheetTitle}" (${rules.length}):`,
	];
	for (let i = 0; i < rules.length; i++) {
		lines.push(
			`${indent}  ${summarizeConditionalRule(rules[i], i, sheetTitles)}`,
		);
	}
	return lines.join("\n");
}

// ─── Conditional rule builders ─────────────────────────────────────────────────

const CONDITION_TYPES = new Set([
	"NUMBER_GREATER",
	"NUMBER_GREATER_THAN_EQ",
	"NUMBER_LESS",
	"NUMBER_LESS_THAN_EQ",
	"NUMBER_EQ",
	"NUMBER_NOT_EQ",
	"TEXT_CONTAINS",
	"TEXT_NOT_CONTAINS",
	"TEXT_STARTS_WITH",
	"TEXT_ENDS_WITH",
	"TEXT_EQ",
	"DATE_BEFORE",
	"DATE_ON_OR_BEFORE",
	"DATE_AFTER",
	"DATE_ON_OR_AFTER",
	"DATE_EQ",
	"DATE_NOT_EQ",
	"DATE_BETWEEN",
	"DATE_NOT_BETWEEN",
	"NOT_BLANK",
	"BLANK",
	"CUSTOM_FORMULA",
	"ONE_OF_RANGE",
]);

const GRADIENT_POINT_TYPES = new Set([
	"MIN",
	"MAX",
	"NUMBER",
	"PERCENT",
	"PERCENTILE",
]);

function parseConditionValues(
	cv: string | Array<string | number> | null | undefined,
): Array<string | number> | null {
	if (cv === null || cv === undefined) return null;
	let parsed: unknown = cv;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			throw new Error(
				"condition_values must be a list or a JSON-encoded list (e.g., '[\"value\"]').",
			);
		}
	}
	if (!Array.isArray(parsed)) parsed = [parsed];
	const arr = parsed as unknown[];
	for (let i = 0; i < arr.length; i++) {
		if (typeof arr[i] !== "string" && typeof arr[i] !== "number")
			throw new Error(
				`condition_values[${i}] must be a string or number, got ${typeof arr[i]}.`,
			);
	}
	return arr as Array<string | number>;
}

function parseGradientPoints(
	gp: string | GradientPointData[] | null | undefined,
): GradientPointData[] | null {
	if (gp === null || gp === undefined) return null;
	let parsed: unknown = gp;
	if (typeof parsed === "string") {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			throw new Error(
				"gradient_points must be a list or JSON-encoded list of gradient point objects.",
			);
		}
	}
	if (!Array.isArray(parsed))
		throw new Error("gradient_points must be a list of point objects.");
	if (parsed.length < 2 || parsed.length > 3)
		throw new Error("Provide 2 or 3 gradient points (min/max or min/mid/max).");

	const normalized: GradientPointData[] = [];
	for (let idx = 0; idx < parsed.length; idx++) {
		const p = parsed[idx] as Record<string, unknown>;
		if (typeof p !== "object" || p === null)
			throw new Error(
				`gradient_points[${idx}] must be an object with type/color.`,
			);
		const pt = String(p.type ?? "");
		if (!pt || !GRADIENT_POINT_TYPES.has(pt.toUpperCase()))
			throw new Error(
				`gradient_points[${idx}].type must be one of ${[...GRADIENT_POINT_TYPES].sort().join(", ")}.`,
			);
		const colorRaw = p.color;
		let colorDict: ColorObj | null = null;
		if (typeof colorRaw === "string") colorDict = parseHexColor(colorRaw);
		else if (typeof colorRaw === "object" && colorRaw !== null)
			colorDict = colorRaw as ColorObj;
		if (!colorDict)
			throw new Error(`gradient_points[${idx}].color is required.`);
		const norm: GradientPointData = {
			type: pt.toUpperCase(),
			color: colorDict,
		};
		if (p.value !== undefined && p.value !== null) norm.value = String(p.value);
		normalized.push(norm);
	}
	return normalized;
}

function buildBooleanRule(
	ranges: GridRange[],
	conditionType: string,
	conditionValues: Array<string | number> | null | undefined,
	bgColor: string | null | undefined,
	textColor: string | null | undefined,
): [ConditionalRule, string] {
	if (!bgColor && !textColor)
		throw new Error(
			"Provide at least one of background_color or text_color for the rule format.",
		);
	const condTypeNorm = conditionType.toUpperCase();
	if (!CONDITION_TYPES.has(condTypeNorm))
		throw new Error(
			`condition_type must be one of ${[...CONDITION_TYPES].sort().join(", ")}.`,
		);

	const condObj: NonNullable<
		NonNullable<ConditionalRule["booleanRule"]>["condition"]
	> = {
		type: condTypeNorm,
	};
	if (conditionValues?.length)
		condObj.values = conditionValues.map((v) => ({
			userEnteredValue: String(v),
		}));

	const fmt: NonNullable<
		NonNullable<ConditionalRule["booleanRule"]>["format"]
	> = {};
	const bg = parseHexColor(bgColor);
	const fg = parseHexColor(textColor);
	if (bg) fmt.backgroundColor = bg;
	if (fg) fmt.textFormat = { foregroundColor: fg };

	return [
		{ ranges, booleanRule: { condition: condObj, format: fmt } },
		condTypeNorm,
	];
}

function buildGradientRule(
	ranges: GridRange[],
	points: GradientPointData[],
): ConditionalRule {
	const gr: ConditionalRule["gradientRule"] = {};
	if (points.length === 2) {
		gr.minpoint = points[0];
		gr.maxpoint = points[1];
	} else {
		gr.minpoint = points[0];
		gr.midpoint = points[1];
		gr.maxpoint = points[2];
	}
	return { ranges, gradientRule: gr };
}

// ─── Grid data extraction helpers ─────────────────────────────────────────────

function extractCellErrors(
	spreadsheet: SpreadsheetWithGrid,
): Array<{ cell: string; type: string | null; message: string | null }> {
	const errors: Array<{
		cell: string;
		type: string | null;
		message: string | null;
	}> = [];
	for (const sheet of spreadsheet.sheets ?? []) {
		const title = sheet.properties?.title ?? "Unknown";
		for (const grid of sheet.data ?? []) {
			const baseRow = grid.startRow ?? 0;
			const baseCol = grid.startColumn ?? 0;
			for (const [ri, row] of (grid.rowData ?? []).entries()) {
				if (!row) continue;
				for (const [ci, cell] of (row.values ?? []).entries()) {
					if (!cell) continue;
					const ev = cell.effectiveValue?.errorValue;
					if (!ev) continue;
					errors.push({
						cell: formatA1Cell(title, baseRow + ri, baseCol + ci),
						type: ev.type ?? null,
						message: ev.message ?? null,
					});
				}
			}
		}
	}
	return errors;
}

function extractCellHyperlinks(
	spreadsheet: SpreadsheetWithGrid,
): Array<{ cell: string; url: string }> {
	const hyperlinks: Array<{ cell: string; url: string }> = [];
	for (const sheet of spreadsheet.sheets ?? []) {
		const title = sheet.properties?.title ?? "Unknown";
		for (const grid of sheet.data ?? []) {
			const baseRow = grid.startRow ?? 0;
			const baseCol = grid.startColumn ?? 0;
			for (const [ri, row] of (grid.rowData ?? []).entries()) {
				if (!row) continue;
				for (const [ci, cell] of (row.values ?? []).entries()) {
					if (!cell) continue;
					const seen = new Set<string>();
					const cellRef = formatA1Cell(title, baseRow + ri, baseCol + ci);
					if (
						typeof cell.hyperlink === "string" &&
						cell.hyperlink &&
						!seen.has(cell.hyperlink)
					) {
						seen.add(cell.hyperlink);
						hyperlinks.push({ cell: cellRef, url: cell.hyperlink });
					}
					for (const run of cell.textFormatRuns ?? []) {
						const uri = run.format?.link?.uri;
						if (typeof uri === "string" && uri && !seen.has(uri)) {
							seen.add(uri);
							hyperlinks.push({ cell: cellRef, url: uri });
						}
					}
				}
			}
		}
	}
	return hyperlinks;
}

function extractCellNotes(
	spreadsheet: SpreadsheetWithGrid,
): Array<{ cell: string; note: string }> {
	const notes: Array<{ cell: string; note: string }> = [];
	for (const sheet of spreadsheet.sheets ?? []) {
		const title = sheet.properties?.title ?? "Unknown";
		for (const grid of sheet.data ?? []) {
			const baseRow = grid.startRow ?? 0;
			const baseCol = grid.startColumn ?? 0;
			for (const [ri, row] of (grid.rowData ?? []).entries()) {
				if (!row) continue;
				for (const [ci, cell] of (row.values ?? []).entries()) {
					if (!cell?.note) continue;
					notes.push({
						cell: formatA1Cell(title, baseRow + ri, baseCol + ci),
						note: cell.note,
					});
				}
			}
		}
	}
	return notes;
}

function formatErrorSection(
	errors: Array<{ cell: string; type: string | null; message: string | null }>,
	rangeLabel: string,
	max = 25,
): string {
	if (!errors.length) return "";
	const lines = errors.slice(0, max).map((e) => {
		const cell = e.cell || "(unknown cell)";
		if (e.type && e.message) return `- ${cell}: ${e.type} — ${e.message}`;
		if (e.message) return `- ${cell}: ${e.message}`;
		if (e.type) return `- ${cell}: ${e.type}`;
		return `- ${cell}: (unknown error)`;
	});
	const suffix =
		errors.length > max ? `\n... and ${errors.length - max} more errors` : "";
	return `\n\nDetailed cell errors in range '${rangeLabel}':\n${lines.join("\n")}${suffix}`;
}

function formatHyperlinkSection(
	hyperlinks: Array<{ cell: string; url: string }>,
	rangeLabel: string,
	max = 25,
): string {
	if (!hyperlinks.length) return "";
	const lines = hyperlinks
		.slice(0, max)
		.map((h) => `- ${h.cell || "(unknown)"}: ${h.url || "(missing)"}`);
	const suffix =
		hyperlinks.length > max
			? `\n... and ${hyperlinks.length - max} more hyperlinks`
			: "";
	return `\n\nHyperlinks in range '${rangeLabel}':\n${lines.join("\n")}${suffix}`;
}

function formatNotesSection(
	notes: Array<{ cell: string; note: string }>,
	rangeLabel: string,
	max = 25,
): string {
	if (!notes.length) return "";
	const lines = notes
		.slice(0, max)
		.map((n) => `- ${n.cell || "(unknown)"}: ${n.note || "(empty)"}`);
	const suffix =
		notes.length > max ? `\n... and ${notes.length - max} more notes` : "";
	return `\n\nCell notes in range '${rangeLabel}':\n${lines.join("\n")}${suffix}`;
}

function formatFormulaSection(
	formulas: Array<{ cell: string; formula: string }>,
	rangeLabel: string,
	max = 50,
): string {
	if (!formulas.length) return "";
	const lines = formulas.slice(0, max).map((f) => `- ${f.cell}: ${f.formula}`);
	const suffix =
		formulas.length > max
			? `\n... and ${formulas.length - max} more formula cells`
			: "";
	return `\n\nFormula cells in range '${rangeLabel}':\n${lines.join("\n")}${suffix}`;
}

// ─── Async API helpers (use accessToken) ──────────────────────────────────────

async function fetchSheetsWithRules(
	accessToken: string,
	spreadsheetId: string,
): Promise<[SheetData[], Map<number, string>]> {
	const url = buildUrl(
		`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
		{
			fields: "sheets(properties(sheetId,title),conditionalFormats)",
		},
	);
	const resp = (await sheetsFetch(accessToken, url)) as SpreadsheetResponse;
	const sheets = resp.sheets ?? [];
	const sheetTitles = new Map<number, string>();
	for (const s of sheets) {
		const sid = s.properties?.sheetId;
		if (sid !== undefined)
			sheetTitles.set(sid, s.properties?.title ?? `Sheet ${sid}`);
	}
	return [sheets, sheetTitles];
}

async function fetchDetailedSheetErrors(
	accessToken: string,
	spreadsheetId: string,
	a1Range: string,
): Promise<
	Array<{ cell: string; type: string | null; message: string | null }>
> {
	const url = buildUrl(
		`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
		{
			ranges: a1Range,
			includeGridData: "true",
			fields:
				"sheets(properties(title),data(startRow,startColumn,rowData(values(effectiveValue(errorValue(type,message))))))",
		},
	);
	try {
		const resp = (await sheetsFetch(accessToken, url)) as SpreadsheetWithGrid;
		return extractCellErrors(resp);
	} catch {
		return [];
	}
}

async function fetchGridMetadata(
	accessToken: string,
	spreadsheetId: string,
	resolvedRange: string,
	values: unknown[][],
	includeHyperlinks: boolean,
	includeNotes: boolean,
): Promise<[string, string]> {
	if (!includeHyperlinks && !includeNotes) return ["", ""];
	const tightRange = a1RangeForValues(resolvedRange, values);
	if (!tightRange) return ["", ""];

	const cellCount =
		a1RangeCellCount(tightRange) ??
		values.reduce((s, r) => s + (r as unknown[]).length, 0);
	if (cellCount > MAX_GRID_METADATA_CELLS) return ["", ""];

	const valFields: string[] = [];
	if (includeHyperlinks)
		valFields.push("hyperlink", "textFormatRuns(format(link(uri)))");
	if (includeNotes) valFields.push("note");
	const fields = `sheets(properties(title),data(startRow,startColumn,rowData(values(${valFields.join(",")}))))`;

	const url = buildUrl(
		`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
		{
			ranges: tightRange,
			includeGridData: "true",
			fields,
		},
	);
	let resp: SpreadsheetWithGrid;
	try {
		resp = (await sheetsFetch(accessToken, url)) as SpreadsheetWithGrid;
	} catch {
		return ["", ""];
	}

	const hyperlinkSection = includeHyperlinks
		? formatHyperlinkSection(extractCellHyperlinks(resp), tightRange)
		: "";
	const notesSection = includeNotes
		? formatNotesSection(extractCellNotes(resp), tightRange)
		: "";
	return [hyperlinkSection, notesSection];
}

async function fetchCellFormulas(
	accessToken: string,
	spreadsheetId: string,
	resolvedRange: string,
): Promise<[string, unknown[][]]> {
	const url = buildUrl(
		`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(resolvedRange)}`,
		{ valueRenderOption: "FORMULA" },
	);
	let formulaValues: unknown[][];
	try {
		const res = (await sheetsFetch(accessToken, url)) as ValueRangeResponse;
		formulaValues = res.values ?? [];
	} catch {
		return ["", []];
	}

	const [sheetName, rangePart] = splitSheetAndRange(resolvedRange);
	const startPart = rangePart.includes(":")
		? rangePart.split(":")[0]
		: rangePart;
	let baseCol = 0;
	let baseRow = 0;
	try {
		const [sc, sr] = parseA1Part(startPart);
		baseCol = sc ?? 0;
		baseRow = sr ?? 0;
	} catch {
		/* use 0 defaults */
	}

	const formulas: Array<{ cell: string; formula: string }> = [];
	for (let ri = 0; ri < formulaValues.length; ri++) {
		const row = formulaValues[ri] as unknown[];
		for (let ci = 0; ci < row.length; ci++) {
			const v = row[ci];
			if (typeof v === "string" && v.startsWith("=")) {
				let cellRef = `${indexToColumn(baseCol + ci)}${baseRow + ri + 1}`;
				if (sheetName) cellRef = `${quoteSheetTitle(sheetName)}!${cellRef}`;
				formulas.push({ cell: cellRef, formula: v });
			}
		}
	}
	return [formatFormulaSection(formulas, resolvedRange), formulaValues];
}

// ─── Extended value helper (for append_table_rows) ────────────────────────────

function toExtendedValue(val: unknown): Record<string, unknown> {
	if (typeof val === "boolean") return { boolValue: val };
	if (typeof val === "number") return { numberValue: val };
	const s = String(val);
	if (s.startsWith("=")) return { formulaValue: s };
	return { stringValue: s };
}

// ─── Comment helpers (for tools 13 & 14) ─────────────────────────────────────

async function readCommentsImpl(
	accessToken: string,
	fileId: string,
	appName: string,
	maxComments: number,
): Promise<string> {
	if (maxComments <= 0) return `No comments found in ${appName} ${fileId}`;

	const comments: DriveComment[] = [];
	let pageToken: string | undefined;

	while (comments.length < maxComments) {
		const remaining = maxComments - comments.length;
		const pageSize = Math.min(100, remaining);
		const url = buildUrl(
			`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments`,
			{
				fields:
					"nextPageToken,comments(id,content,author,createdTime,modifiedTime,resolved,quotedFileContent,replies(content,author,id,createdTime,modifiedTime))",
				pageSize,
				...(pageToken ? { pageToken } : {}),
			},
		);
		const resp = (await sheetsFetch(accessToken, url)) as DriveCommentsResponse;
		const page = resp.comments ?? [];
		const take = Math.min(page.length, maxComments - comments.length);
		comments.push(...page.slice(0, take));
		pageToken = resp.nextPageToken;
		if (!pageToken || comments.length >= maxComments) break;
	}

	if (!comments.length) return `No comments found in ${appName} ${fileId}`;

	const output: string[] = [
		`Found ${comments.length} comments in ${appName} ${fileId}:\n`,
	];
	for (const c of comments) {
		const author = c.author?.displayName ?? "Unknown";
		const status = c.resolved ? " [RESOLVED]" : "";
		output.push(`Comment ID: ${c.id ?? ""}`);
		output.push(`Author: ${author}`);
		output.push(`Created: ${c.createdTime ?? ""}${status}`);
		const quoted = c.quotedFileContent?.value;
		if (quoted) output.push(`Quoted text: ${quoted}`);
		output.push(`Content: ${c.content ?? ""}`);
		const replies = c.replies ?? [];
		if (replies.length) {
			output.push(`  Replies (${replies.length}):`);
			for (const r of replies) {
				output.push(`    Reply ID: ${r.id ?? ""}`);
				output.push(`    Author: ${r.author?.displayName ?? "Unknown"}`);
				output.push(`    Created: ${r.createdTime ?? ""}`);
				output.push(`    Content: ${r.content ?? ""}`);
			}
		}
		output.push("");
	}
	return output.join("\n");
}

// ─── register ─────────────────────────────────────────────────────────────────

export function register(server: McpServer, ctx: ToolContext): void {
	// ── 1. list_spreadsheets ───────────────────────────────────────────────────
	server.tool(
		"list_spreadsheets",
		"List Google Spreadsheets accessible to the connected account, ordered by most recently modified.",
		{
			max_results: z
				.number()
				.int()
				.default(25)
				.describe("Maximum number of spreadsheets to return. Defaults to 25."),
		},
		async ({ max_results }) => {
			const { accessToken } = await ctx.getService("gsheets");
			const url = buildUrl(`${DRIVE_BASE}/files`, {
				q: "mimeType='application/vnd.google-apps.spreadsheet'",
				pageSize: max_results,
				fields: "files(id,name,modifiedTime,webViewLink)",
				orderBy: "modifiedTime desc",
				supportsAllDrives: "true",
				includeItemsFromAllDrives: "true",
			});
			const resp = (await sheetsFetch(accessToken, url)) as DriveFilesResponse;
			const files = resp.files ?? [];
			if (!files.length)
				return {
					content: [{ type: "text" as const, text: "No spreadsheets found." }],
				};
			const lines = [`Successfully listed ${files.length} spreadsheet(s):`];
			for (const f of files) {
				lines.push(
					`- "${f.name ?? "Untitled"}" (ID: ${f.id ?? "?"}) | Modified: ${f.modifiedTime ?? "Unknown"} | Link: ${f.webViewLink ?? "No link"}`,
				);
			}
			return { content: [{ type: "text" as const, text: lines.join("\n") }] };
		},
	);

	// ── 2. get_spreadsheet_info ────────────────────────────────────────────────
	server.tool(
		"get_spreadsheet_info",
		"Get metadata for a Google Spreadsheet: title, locale, sheet list, dimensions, and conditional format counts.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
		},
		async ({ spreadsheet_id }) => {
			const { accessToken } = await ctx.getService("gsheets");
			const url = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}`,
				{
					fields:
						"spreadsheetId,properties(title,locale),sheets(properties(title,sheetId,gridProperties(rowCount,columnCount)),conditionalFormats)",
				},
			);
			const resp = (await sheetsFetch(accessToken, url)) as SpreadsheetResponse;
			const props = resp.properties ?? {};
			const title = props.title ?? "Unknown";
			const locale = props.locale ?? "Unknown";
			const sheets = resp.sheets ?? [];

			// Build sheetTitles map for conditional format formatting
			const sheetTitles = new Map<number, string>();
			for (const s of sheets) {
				const sid = s.properties?.sheetId;
				if (sid !== undefined)
					sheetTitles.set(sid, s.properties?.title ?? `Sheet ${sid}`);
			}

			const sheetsInfo: string[] = [];
			for (const s of sheets) {
				const sp = s.properties ?? {};
				const sname = sp.title ?? "Unknown";
				const sid = sp.sheetId ?? "Unknown";
				const gp = sp.gridProperties ?? {};
				const rows = gp.rowCount ?? "Unknown";
				const cols = gp.columnCount ?? "Unknown";
				const rules = s.conditionalFormats ?? [];
				sheetsInfo.push(
					`  - "${sname}" (ID: ${sid}) | Size: ${rows}x${cols} | Conditional formats: ${rules.length}`,
				);
				if (rules.length) {
					sheetsInfo.push(
						formatConditionalRulesSection(sname, rules, sheetTitles, "    "),
					);
				}
			}

			const text = [
				`Spreadsheet: "${title}" (ID: ${spreadsheet_id}) | Locale: ${locale}`,
				`Sheets (${sheets.length}):`,
				sheetsInfo.length ? sheetsInfo.join("\n") : "  No sheets found",
			].join("\n");
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 3. read_sheet_values ──────────────────────────────────────────────────
	server.tool(
		"read_sheet_values",
		"Read cell values from a range in a Google Sheet. Optionally include hyperlinks, notes, or formulas.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			range_name: z
				.string()
				.default("A1:Z1000")
				.describe(
					"A1-style range, e.g. 'Sheet1!A1:D10' or 'A1:D10'. Defaults to 'A1:Z1000'.",
				),
			include_hyperlinks: z
				.boolean()
				.default(false)
				.describe("Include hyperlink metadata for cells in the range."),
			include_notes: z
				.boolean()
				.default(false)
				.describe("Include cell notes for the range."),
			include_formulas: z
				.boolean()
				.default(false)
				.describe("Include raw formula strings for formula cells."),
		},
		async ({
			spreadsheet_id,
			range_name,
			include_hyperlinks,
			include_notes,
			include_formulas,
		}) => {
			const { accessToken } = await ctx.getService("gsheets");

			const valUrl = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodeURIComponent(range_name)}`,
				{},
			);
			const result = (await sheetsFetch(
				accessToken,
				valUrl,
			)) as ValueRangeResponse;
			const values = result.values ?? [];
			const resolvedRange = result.range ?? range_name;

			const [hyperlinkSection, notesSection] = await fetchGridMetadata(
				accessToken,
				spreadsheet_id,
				resolvedRange,
				values,
				include_hyperlinks,
				include_notes,
			);

			let formulaSection = "";
			let formulaValues: unknown[][] = [];
			if (include_formulas) {
				[formulaSection, formulaValues] = await fetchCellFormulas(
					accessToken,
					spreadsheet_id,
					resolvedRange,
				);
			}

			if (!values.length && !formulaValues.length) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No data found in range '${range_name}'.`,
						},
					],
				};
			}

			if (!values.length) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								`No displayed values found in range '${range_name}' in spreadsheet ${spreadsheet_id}. ` +
								`The range contains formula cells.${formulaSection}`,
						},
					],
				};
			}

			const detailedRange =
				a1RangeForValues(resolvedRange, values) ?? resolvedRange;
			let detailedErrorsSection = "";
			if (valuesContainSheetsErrors(values)) {
				const errors = await fetchDetailedSheetErrors(
					accessToken,
					spreadsheet_id,
					detailedRange,
				);
				detailedErrorsSection = formatErrorSection(errors, detailedRange);
			}

			const headerWidth = values[0] ? (values[0] as unknown[]).length : 0;
			const formattedRows = values.slice(0, 50).map((row, i) => {
				const padded = [
					...(row as unknown[]),
					...Array(Math.max(0, headerWidth - (row as unknown[]).length)).fill(
						"",
					),
				];
				return `Row ${String(i + 1).padStart(2)}: ${JSON.stringify(padded)}`;
			});
			const truncNote =
				values.length > 50 ? `\n... and ${values.length - 50} more rows` : "";

			const text =
				`Successfully read ${values.length} rows from range '${range_name}' in spreadsheet ${spreadsheet_id}:\n` +
				formattedRows.join("\n") +
				truncNote +
				hyperlinkSection +
				notesSection +
				formulaSection +
				detailedErrorsSection;
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 4. modify_sheet_values ────────────────────────────────────────────────
	server.tool(
		"modify_sheet_values",
		"Write values to a range in a Google Sheet, or clear a range.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			range_name: z.string().describe("A1-style range, e.g. 'Sheet1!A1:D10'."),
			values: z
				.union([z.string(), z.array(z.array(z.unknown()))])
				.optional()
				.describe(
					"2D array of values to write. Can be a JSON string or array. Required unless clear_values=true.",
				),
			value_input_option: z
				.enum(["RAW", "USER_ENTERED"])
				.default("USER_ENTERED")
				.describe("How to interpret input values."),
			clear_values: z
				.boolean()
				.default(false)
				.describe("If true, clears the range instead of writing values."),
		},
		async ({
			spreadsheet_id,
			range_name,
			values,
			value_input_option,
			clear_values,
		}) => {
			const { accessToken } = await ctx.getService("gsheets");

			// Parse values if JSON string
			let parsedValues: unknown[][] | undefined;
			if (values !== undefined) {
				if (typeof values === "string") {
					try {
						const p = JSON.parse(values) as unknown;
						if (!Array.isArray(p))
							throw new Error(`Values must be a list, got ${typeof p}`);
						parsedValues = p as unknown[][];
					} catch (e) {
						throw new Error(`Invalid JSON format for values: ${String(e)}`);
					}
				} else {
					parsedValues = values as unknown[][];
				}
			}

			if (!clear_values && !parsedValues)
				throw new Error(
					"Either 'values' must be provided or 'clear_values' must be true.",
				);

			if (clear_values) {
				const url = `${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodeURIComponent(range_name)}:clear`;
				const resp = (await sheetsFetch(accessToken, url, {
					method: "POST",
					body: "{}",
				})) as ClearValuesResponse;
				const cleared = resp.clearedRange ?? range_name;
				return {
					content: [
						{
							type: "text" as const,
							text: `Successfully cleared range '${cleared}' in spreadsheet ${spreadsheet_id}.`,
						},
					],
				};
			}

			const url = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${encodeURIComponent(range_name)}`,
				{
					valueInputOption: value_input_option,
					includeValuesInResponse: "true",
					responseValueRenderOption: "FORMATTED_VALUE",
				},
			);
			const resp = (await sheetsFetch(accessToken, url, {
				method: "PUT",
				body: JSON.stringify({ values: parsedValues }),
			})) as UpdateValuesResponse;

			const cells = resp.updatedCells ?? 0;
			const rows = resp.updatedRows ?? 0;
			const cols = resp.updatedColumns ?? 0;

			let errSection = "";
			const updatedVals = resp.updatedData?.values ?? [];
			if (updatedVals.length && valuesContainSheetsErrors(updatedVals)) {
				const updatedRange = resp.updatedRange ?? range_name;
				const detailedRange =
					a1RangeForValues(updatedRange, updatedVals) ?? updatedRange;
				const errors = await fetchDetailedSheetErrors(
					accessToken,
					spreadsheet_id,
					detailedRange,
				);
				errSection = formatErrorSection(errors, detailedRange);
			}

			return {
				content: [
					{
						type: "text" as const,
						text:
							`Successfully updated range '${range_name}' in spreadsheet ${spreadsheet_id}. ` +
							`Updated: ${cells} cells, ${rows} rows, ${cols} columns.${errSection}`,
					},
				],
			};
		},
	);

	// ── 5. format_sheet_range ─────────────────────────────────────────────────
	server.tool(
		"format_sheet_range",
		"Apply cell formatting to a range: colors, number formats, text wrapping, alignment, and text styling.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			range_name: z
				.string()
				.describe("A1-style range, optionally with sheet name."),
			background_color: z
				.string()
				.optional()
				.describe("Hex background color, e.g. '#FFEECC'."),
			text_color: z
				.string()
				.optional()
				.describe("Hex text color, e.g. '#000000'."),
			number_format_type: z
				.enum([
					"NUMBER",
					"NUMBER_WITH_GROUPING",
					"CURRENCY",
					"PERCENT",
					"SCIENTIFIC",
					"DATE",
					"TIME",
					"DATE_TIME",
					"TEXT",
				])
				.optional()
				.describe("Sheets number format type."),
			number_format_pattern: z
				.string()
				.optional()
				.describe("Optional custom pattern for the number format."),
			wrap_strategy: z
				.enum(["WRAP", "CLIP", "OVERFLOW_CELL"])
				.optional()
				.describe("Text wrap strategy."),
			horizontal_alignment: z
				.enum(["LEFT", "CENTER", "RIGHT"])
				.optional()
				.describe("Horizontal text alignment."),
			vertical_alignment: z
				.enum(["TOP", "MIDDLE", "BOTTOM"])
				.optional()
				.describe("Vertical text alignment."),
			bold: z.boolean().optional().describe("Apply bold formatting."),
			italic: z.boolean().optional().describe("Apply italic formatting."),
			font_size: z.number().int().optional().describe("Font size in points."),
		},
		async ({
			spreadsheet_id,
			range_name,
			background_color,
			text_color,
			number_format_type,
			number_format_pattern,
			wrap_strategy,
			horizontal_alignment,
			vertical_alignment,
			bold,
			italic,
			font_size,
		}) => {
			const hasAny =
				background_color !== undefined ||
				text_color !== undefined ||
				number_format_type !== undefined ||
				wrap_strategy !== undefined ||
				horizontal_alignment !== undefined ||
				vertical_alignment !== undefined ||
				bold !== undefined ||
				italic !== undefined ||
				font_size !== undefined;
			if (!hasAny)
				throw new Error(
					"Provide at least one formatting option (background_color, text_color, number_format_type, wrap_strategy, horizontal_alignment, vertical_alignment, bold, italic, or font_size).",
				);

			const { accessToken } = await ctx.getService("gsheets");

			// Fetch sheet metadata to resolve A1 range
			const metaUrl = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}`,
				{ fields: "sheets(properties(sheetId,title))" },
			);
			const metaResp = (await sheetsFetch(
				accessToken,
				metaUrl,
			)) as SpreadsheetResponse;
			const sheets = metaResp.sheets ?? [];
			const gridRange = parseA1Range(range_name, sheets);

			// Build userEnteredFormat and fields list
			const userEnteredFormat: Record<string, unknown> = {};
			const fields: string[] = [];

			const bgParsed = parseHexColor(background_color);
			if (bgParsed) {
				userEnteredFormat.backgroundColor = bgParsed;
				fields.push("userEnteredFormat.backgroundColor");
			}

			const textFormat: Record<string, unknown> = {};
			const fgParsed = parseHexColor(text_color);
			if (fgParsed) {
				textFormat.foregroundColor = fgParsed;
				fields.push("userEnteredFormat.textFormat.foregroundColor");
			}
			if (bold !== undefined) {
				textFormat.bold = bold;
				fields.push("userEnteredFormat.textFormat.bold");
			}
			if (italic !== undefined) {
				textFormat.italic = italic;
				fields.push("userEnteredFormat.textFormat.italic");
			}
			if (font_size !== undefined) {
				textFormat.fontSize = font_size;
				fields.push("userEnteredFormat.textFormat.fontSize");
			}
			if (Object.keys(textFormat).length)
				userEnteredFormat.textFormat = textFormat;

			if (number_format_type !== undefined) {
				const nf: Record<string, unknown> = { type: number_format_type };
				if (number_format_pattern) nf.pattern = number_format_pattern;
				userEnteredFormat.numberFormat = nf;
				fields.push("userEnteredFormat.numberFormat");
			}
			if (wrap_strategy !== undefined) {
				userEnteredFormat.wrapStrategy = wrap_strategy;
				fields.push("userEnteredFormat.wrapStrategy");
			}
			if (horizontal_alignment !== undefined) {
				userEnteredFormat.horizontalAlignment = horizontal_alignment;
				fields.push("userEnteredFormat.horizontalAlignment");
			}
			if (vertical_alignment !== undefined) {
				userEnteredFormat.verticalAlignment = vertical_alignment;
				fields.push("userEnteredFormat.verticalAlignment");
			}

			const batchUrl = `${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`;
			await sheetsFetch(accessToken, batchUrl, {
				method: "POST",
				body: JSON.stringify({
					requests: [
						{
							repeatCell: {
								range: gridRange,
								cell: { userEnteredFormat },
								fields: fields.join(","),
							},
						},
					],
				}),
			});

			// Build confirmation description
			const parts: string[] = [];
			if (bgParsed) parts.push(`background ${background_color}`);
			if (fgParsed) parts.push(`text color ${text_color}`);
			if (number_format_type) {
				let nfDesc = number_format_type;
				if (number_format_pattern)
					nfDesc += ` (pattern: ${number_format_pattern})`;
				parts.push(`number format ${nfDesc}`);
			}
			if (wrap_strategy) parts.push(`wrap ${wrap_strategy}`);
			if (horizontal_alignment)
				parts.push(`horizontal align ${horizontal_alignment}`);
			if (vertical_alignment)
				parts.push(`vertical align ${vertical_alignment}`);
			if (bold !== undefined) parts.push(bold ? "bold" : "not bold");
			if (italic !== undefined) parts.push(italic ? "italic" : "not italic");
			if (font_size !== undefined) parts.push(`font size ${font_size}`);

			return {
				content: [
					{
						type: "text" as const,
						text: `Applied formatting to range '${range_name}' in spreadsheet ${spreadsheet_id}: ${parts.join(", ")}.`,
					},
				],
			};
		},
	);

	// ── 6. manage_conditional_formatting ──────────────────────────────────────
	server.tool(
		"manage_conditional_formatting",
		"Add, update, or delete conditional formatting rules on a Google Sheet.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			action: z
				.enum(["add", "update", "delete"])
				.describe("Operation to perform."),
			range_name: z
				.string()
				.optional()
				.describe("A1-style range. Required for 'add'. Optional for 'update'."),
			condition_type: z
				.string()
				.optional()
				.describe(
					"Sheets condition type, e.g. NUMBER_GREATER, TEXT_CONTAINS, CUSTOM_FORMULA.",
				),
			condition_values: z
				.union([z.string(), z.array(z.union([z.string(), z.number()]))])
				.optional()
				.describe("Values for the condition; list or JSON string."),
			background_color: z
				.string()
				.optional()
				.describe(
					"Hex background color when condition matches, e.g. '#FF0000'.",
				),
			text_color: z
				.string()
				.optional()
				.describe("Hex text color when condition matches."),
			rule_index: z
				.number()
				.int()
				.optional()
				.describe(
					"0-based rule index. Required for 'update' and 'delete'. Optional insertion position for 'add'.",
				),
			gradient_points: z
				.union([z.string(), z.array(z.record(z.unknown()))])
				.optional()
				.describe(
					"List or JSON list of gradient points for a color scale rule. Each point needs type (MIN/MAX/NUMBER/PERCENT/PERCENTILE) and color.",
				),
			sheet_name: z
				.string()
				.optional()
				.describe(
					"Sheet name for 'update'/'delete' when range_name is omitted.",
				),
		},
		async ({
			spreadsheet_id,
			action,
			range_name,
			condition_type,
			condition_values,
			background_color,
			text_color,
			rule_index,
			gradient_points,
			sheet_name,
		}) => {
			const { accessToken } = await ctx.getService("gsheets");
			const batchUrl = `${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`;

			if (action === "add") {
				if (!range_name)
					throw new Error("range_name is required for action 'add'.");
				if (!condition_type && !gradient_points)
					throw new Error(
						"condition_type (or gradient_points) is required for action 'add'.",
					);
				if (rule_index !== undefined && rule_index < 0)
					throw new Error(
						"rule_index must be a non-negative integer when provided.",
					);

				const gpList = parseGradientPoints(
					gradient_points as string | GradientPointData[] | null | undefined,
				);
				const cvList = gpList
					? null
					: parseConditionValues(
							condition_values as
								| string
								| Array<string | number>
								| null
								| undefined,
						);

				const [sheets, sheetTitles] = await fetchSheetsWithRules(
					accessToken,
					spreadsheet_id,
				);
				const gridRange = parseA1Range(range_name, sheets);

				const targetSheet = sheets.find(
					(s) => s.properties?.sheetId === gridRange.sheetId,
				);
				if (!targetSheet)
					throw new Error(
						"Target sheet not found while adding conditional formatting.",
					);

				const currentRules = targetSheet.conditionalFormats ?? [];
				const insertAt =
					rule_index !== undefined ? rule_index : currentRules.length;
				if (insertAt > currentRules.length)
					throw new Error(
						`rule_index ${insertAt} is out of range (current count: ${currentRules.length}).`,
					);

				let newRule: ConditionalRule;
				let ruleDesc: string;
				let valuesDesc = "";
				const appliedParts: string[] = [];

				if (gpList) {
					newRule = buildGradientRule([gridRange], gpList);
					ruleDesc = "gradient";
					appliedParts.push(`gradient points ${gpList.length}`);
				} else {
					const [rule, ct] = buildBooleanRule(
						[gridRange],
						condition_type ?? "",
						cvList,
						background_color,
						text_color,
					);
					newRule = rule;
					ruleDesc = ct;
					if (cvList?.length)
						valuesDesc = ` with values ${JSON.stringify(cvList)}`;
					if (background_color)
						appliedParts.push(`background ${background_color}`);
					if (text_color) appliedParts.push(`text ${text_color}`);
				}

				const newRulesState = [...currentRules];
				newRulesState.splice(insertAt, 0, newRule);

				const addReq: Record<string, unknown> = { rule: newRule };
				if (rule_index !== undefined) addReq.index = rule_index;

				await sheetsFetch(accessToken, batchUrl, {
					method: "POST",
					body: JSON.stringify({
						requests: [{ addConditionalFormatRule: addReq }],
					}),
				});

				const sheetTitle = targetSheet.properties?.title ?? "Unknown";
				const stateText = formatConditionalRulesSection(
					sheetTitle,
					newRulesState,
					sheetTitles,
					"",
				);
				return {
					content: [
						{
							type: "text" as const,
							text: [
								`Added conditional format on '${range_name}' in spreadsheet ${spreadsheet_id}: ${ruleDesc}${valuesDesc}; format: ${appliedParts.join(", ") || "format applied"}.`,
								stateText,
							].join("\n"),
						},
					],
				};
			}

			if (action === "update") {
				if (rule_index === undefined)
					throw new Error("rule_index is required for action 'update'.");
				if (rule_index < 0)
					throw new Error("rule_index must be a non-negative integer.");

				const gpList = parseGradientPoints(
					gradient_points as string | GradientPointData[] | null | undefined,
				);
				const cvList =
					gpList !== null
						? null
						: parseConditionValues(
								condition_values as
									| string
									| Array<string | number>
									| null
									| undefined,
							);

				const [sheets, sheetTitles] = await fetchSheetsWithRules(
					accessToken,
					spreadsheet_id,
				);

				let targetSheet: SheetData | undefined;
				let gridRange: GridRange | undefined;
				if (range_name) {
					gridRange = parseA1Range(range_name, sheets);
					targetSheet = sheets.find(
						(s) => s.properties?.sheetId === gridRange?.sheetId,
					);
				} else {
					targetSheet = selectSheet(sheets, sheet_name);
				}
				if (!targetSheet)
					throw new Error(
						"Target sheet not found while updating conditional formatting.",
					);

				const sp = targetSheet.properties ?? {};
				const sheetId = sp.sheetId ?? 0;
				const sheetTitle = sp.title ?? `Sheet ${sheetId}`;
				const rules = targetSheet.conditionalFormats ?? [];

				if (rule_index >= rules.length)
					throw new Error(
						`rule_index ${rule_index} is out of range for sheet '${sheetTitle}' (current count: ${rules.length}).`,
					);

				const existingRule = rules[rule_index];
				let rangesToUse = existingRule.ranges ?? [];
				if (gridRange) rangesToUse = [gridRange];
				if (!rangesToUse.length) rangesToUse = [{ sheetId }];

				let newRule: ConditionalRule;
				let ruleDesc = "";
				let valuesDesc = "";
				let formatDesc = "";

				if (gpList !== null) {
					newRule = buildGradientRule(rangesToUse, gpList);
					ruleDesc = "gradient";
					formatDesc = `gradient points ${gpList.length}`;
				} else if (existingRule.gradientRule) {
					if (background_color || text_color || condition_type || cvList) {
						throw new Error(
							"Existing rule is a gradient rule. Provide gradient_points to update it, or omit formatting/condition parameters to keep it unchanged.",
						);
					}
					newRule = {
						ranges: rangesToUse,
						gradientRule: existingRule.gradientRule,
					};
					ruleDesc = "gradient";
					formatDesc = "gradient (unchanged)";
				} else {
					const existingBoolean = existingRule.booleanRule ?? {};
					const existingCondition = existingBoolean.condition ?? {};
					const existingFormat = JSON.parse(
						JSON.stringify(existingBoolean.format ?? {}),
					) as typeof existingBoolean.format;

					const ct = (
						condition_type ??
						existingCondition.type ??
						""
					).toUpperCase();
					if (!ct)
						throw new Error("condition_type is required for boolean rules.");
					if (!CONDITION_TYPES.has(ct))
						throw new Error(
							`condition_type must be one of ${[...CONDITION_TYPES].sort().join(", ")}.`,
						);

					const condVals =
						cvList !== null
							? cvList.map((v) => ({ userEnteredValue: String(v) }))
							: (existingCondition.values ?? undefined);

					type BoolFmt = {
						backgroundColor?: ColorObj;
						textFormat?: { foregroundColor?: ColorObj };
					};
					const newFormat = JSON.parse(
						JSON.stringify(existingFormat ?? {}),
					) as BoolFmt;
					if (background_color !== undefined) {
						const bg = parseHexColor(background_color);
						if (bg) newFormat.backgroundColor = bg;
						else delete newFormat.backgroundColor;
					}
					if (text_color !== undefined) {
						const fg = parseHexColor(text_color);
						const tf: BoolFmt["textFormat"] = JSON.parse(
							JSON.stringify(newFormat.textFormat ?? {}),
						);
						if (tf && fg) tf.foregroundColor = fg;
						else if (tf) delete tf.foregroundColor;
						if (tf && Object.keys(tf).length) newFormat.textFormat = tf;
						else delete newFormat.textFormat;
					}
					if (!newFormat || !Object.keys(newFormat).length)
						throw new Error(
							"At least one format option must remain on the rule.",
						);

					newRule = {
						ranges: rangesToUse,
						booleanRule: {
							condition: {
								type: ct,
								...(condVals ? { values: condVals } : {}),
							},
							format: newFormat,
						},
					};
					ruleDesc = ct;
					if (cvList?.length)
						valuesDesc = ` with values ${JSON.stringify(cvList)}`;
					const fmtParts: string[] = [];
					if (newFormat.backgroundColor) fmtParts.push("background updated");
					if (newFormat.textFormat?.foregroundColor)
						fmtParts.push("text color updated");
					formatDesc = fmtParts.length
						? fmtParts.join(", ")
						: "format preserved";
				}

				const newRulesState = JSON.parse(
					JSON.stringify(rules),
				) as ConditionalRule[];
				newRulesState[rule_index] = newRule;

				await sheetsFetch(accessToken, batchUrl, {
					method: "POST",
					body: JSON.stringify({
						requests: [
							{
								updateConditionalFormatRule: {
									index: rule_index,
									sheetId,
									rule: newRule,
								},
							},
						],
					}),
				});

				const stateText = formatConditionalRulesSection(
					sheetTitle,
					newRulesState,
					sheetTitles,
					"",
				);
				return {
					content: [
						{
							type: "text" as const,
							text: [
								`Updated conditional format at index ${rule_index} on sheet '${sheetTitle}' in spreadsheet ${spreadsheet_id}: ${ruleDesc}${valuesDesc}; format: ${formatDesc}.`,
								stateText,
							].join("\n"),
						},
					],
				};
			}

			// action === "delete"
			if (rule_index === undefined)
				throw new Error("rule_index is required for action 'delete'.");
			if (rule_index < 0)
				throw new Error("rule_index must be a non-negative integer.");

			const [sheets, sheetTitles] = await fetchSheetsWithRules(
				accessToken,
				spreadsheet_id,
			);
			const targetSheet = selectSheet(sheets, sheet_name);
			const sp = targetSheet.properties ?? {};
			const sheetId = sp.sheetId ?? 0;
			const sheetTitle = sp.title ?? `Sheet ${sheetId}`;
			const rules = targetSheet.conditionalFormats ?? [];

			if (rule_index >= rules.length)
				throw new Error(
					`rule_index ${rule_index} is out of range for sheet '${sheetTitle}' (current count: ${rules.length}).`,
				);

			const newRulesState = JSON.parse(
				JSON.stringify(rules),
			) as ConditionalRule[];
			newRulesState.splice(rule_index, 1);

			await sheetsFetch(accessToken, batchUrl, {
				method: "POST",
				body: JSON.stringify({
					requests: [
						{ deleteConditionalFormatRule: { index: rule_index, sheetId } },
					],
				}),
			});

			const stateText = formatConditionalRulesSection(
				sheetTitle,
				newRulesState,
				sheetTitles,
				"",
			);
			return {
				content: [
					{
						type: "text" as const,
						text: [
							`Deleted conditional format at index ${rule_index} on sheet '${sheetTitle}' in spreadsheet ${spreadsheet_id}.`,
							stateText,
						].join("\n"),
					},
				],
			};
		},
	);

	// ── 7. create_spreadsheet ─────────────────────────────────────────────────
	server.tool(
		"create_spreadsheet",
		"Create a new Google Spreadsheet with optional initial sheet names.",
		{
			title: z.string().describe("Title of the new spreadsheet."),
			sheet_names: z
				.array(z.string())
				.optional()
				.describe(
					"Optional list of sheet names to create. Defaults to one sheet with default name.",
				),
		},
		async ({ title, sheet_names }) => {
			const { accessToken } = await ctx.getService("gsheets");
			const body: Record<string, unknown> = { properties: { title } };
			if (sheet_names?.length) {
				body.sheets = sheet_names.map((n) => ({ properties: { title: n } }));
			}
			const url = buildUrl(`${SHEETS_BASE}/spreadsheets`, {
				fields: "spreadsheetId,spreadsheetUrl,properties(title,locale)",
			});
			const resp = (await sheetsFetch(accessToken, url, {
				method: "POST",
				body: JSON.stringify(body),
			})) as SpreadsheetResponse;

			const sid = resp.spreadsheetId ?? "";
			const surl = resp.spreadsheetUrl ?? "";
			const locale = resp.properties?.locale ?? "Unknown";
			return {
				content: [
					{
						type: "text" as const,
						text: `Successfully created spreadsheet '${title}'. ID: ${sid} | URL: ${surl} | Locale: ${locale}`,
					},
				],
			};
		},
	);

	// ── 8. create_sheet ───────────────────────────────────────────────────────
	server.tool(
		"create_sheet",
		"Add a new sheet to a spreadsheet, or duplicate an existing sheet.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			sheet_name: z
				.string()
				.optional()
				.describe(
					"Name for the new sheet. Optional when creating; used as new name when duplicating.",
				),
			source_sheet_name: z
				.string()
				.optional()
				.describe(
					"If provided, duplicates this existing sheet instead of creating a blank one.",
				),
			insert_sheet_index: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"0-based position to insert the new sheet. Appends to end if omitted.",
				),
		},
		async ({
			spreadsheet_id,
			sheet_name,
			source_sheet_name,
			insert_sheet_index,
		}) => {
			const { accessToken } = await ctx.getService("gsheets");
			const batchUrl = `${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`;

			if (source_sheet_name !== undefined) {
				// Duplicate path
				const src = source_sheet_name.trim();
				if (!src)
					throw new Error("source_sheet_name must be a non-empty string.");

				const metaUrl = buildUrl(
					`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}`,
					{ fields: "sheets.properties" },
				);
				const metaResp = (await sheetsFetch(
					accessToken,
					metaUrl,
				)) as SpreadsheetResponse;
				const sheets = metaResp.sheets ?? [];
				const sourceSheet = selectSheet(sheets, src);
				const sourceSheetId = sourceSheet.properties?.sheetId;

				const dupReq: Record<string, unknown> = { sourceSheetId };
				if (sheet_name !== undefined) dupReq.newSheetName = sheet_name;
				if (insert_sheet_index !== undefined)
					dupReq.insertSheetIndex = insert_sheet_index;

				const resp = (await sheetsFetch(accessToken, batchUrl, {
					method: "POST",
					body: JSON.stringify({ requests: [{ duplicateSheet: dupReq }] }),
				})) as {
					replies?: Array<{
						duplicateSheet?: {
							properties?: { sheetId?: number; title?: string };
						};
					}>;
				};

				const newProps = resp.replies?.[0]?.duplicateSheet?.properties ?? {};
				const newId = newProps.sheetId ?? "?";
				const newTitle = newProps.title ?? sheet_name ?? "Copy";
				return {
					content: [
						{
							type: "text" as const,
							text: `Successfully duplicated '${src}' to '${newTitle}' (ID: ${newId}) in spreadsheet ${spreadsheet_id}.`,
						},
					],
				};
			}

			// New sheet path
			const addReq: Record<string, unknown> = { properties: {} };
			const addProps = addReq.properties as Record<string, unknown>;
			if (sheet_name !== undefined) addProps.title = sheet_name;
			if (insert_sheet_index !== undefined) addProps.index = insert_sheet_index;

			const resp = (await sheetsFetch(accessToken, batchUrl, {
				method: "POST",
				body: JSON.stringify({ requests: [{ addSheet: addReq }] }),
			})) as {
				replies?: Array<{
					addSheet?: { properties?: { sheetId?: number; title?: string } };
				}>;
			};

			const sheetProps = resp.replies?.[0]?.addSheet?.properties ?? {};
			const sheetId = sheetProps.sheetId ?? "?";
			const createdName = sheetProps.title ?? sheet_name ?? "Untitled";
			return {
				content: [
					{
						type: "text" as const,
						text: `Successfully created sheet '${createdName}' (ID: ${sheetId}) in spreadsheet ${spreadsheet_id}.`,
					},
				],
			};
		},
	);

	// ── 9. list_sheet_tables ──────────────────────────────────────────────────
	server.tool(
		"list_sheet_tables",
		"List structured tables in a spreadsheet with their IDs, names, ranges, and columns. Use to find table IDs for append_table_rows.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
		},
		async ({ spreadsheet_id }) => {
			const { accessToken } = await ctx.getService("gsheets");
			const url = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}`,
				{
					fields: "sheets(properties(title,sheetId),tables)",
				},
			);
			const resp = (await sheetsFetch(accessToken, url)) as SpreadsheetResponse;

			const found: string[] = [];
			for (const sheet of resp.sheets ?? []) {
				const sheetTitle = sheet.properties?.title ?? "Unknown";
				for (const table of sheet.tables ?? []) {
					const tableId = table.tableId ?? "?";
					const name = table.name ?? "Unnamed";
					const r = table.range ?? {};
					const columns = (table.columnProperties ?? [])
						.map((c) => c.columnName ?? "")
						.filter(Boolean);
					found.push(
						[
							`  Table ID: ${tableId}`,
							`  Name: ${name}`,
							`  Sheet: ${sheetTitle}`,
							`  Range: rows ${r.startRowIndex ?? 0}-${r.endRowIndex ?? "?"}, cols ${r.startColumnIndex ?? 0}-${r.endColumnIndex ?? "?"}`,
							`  Columns: ${columns.length ? columns.join(", ") : "N/A"}`,
						].join("\n"),
					);
				}
			}

			if (!found.length) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No structured tables found in spreadsheet ${spreadsheet_id}.`,
						},
					],
				};
			}
			return {
				content: [
					{
						type: "text" as const,
						text: `Found ${found.length} table(s) in spreadsheet ${spreadsheet_id}:\n\n${found.join("\n\n")}`,
					},
				],
			};
		},
	);

	// ── 10. append_table_rows ─────────────────────────────────────────────────
	server.tool(
		"append_table_rows",
		"Append rows to a structured table in a Google Sheet. Use list_sheet_tables to find the table ID.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			table_id: z
				.string()
				.describe("The ID of the table to append to (from list_sheet_tables)."),
			values: z
				.union([z.string(), z.array(z.array(z.unknown()))])
				.describe(
					"2D array of values to append. Each inner list is one row. Can be JSON string.",
				),
		},
		async ({ spreadsheet_id, table_id, values }) => {
			const { accessToken } = await ctx.getService("gsheets");

			// Parse values if JSON string
			let parsedValues: unknown[][];
			if (typeof values === "string") {
				try {
					parsedValues = JSON.parse(values) as unknown[][];
				} catch (e) {
					throw new Error(`Invalid JSON in values parameter: ${String(e)}`);
				}
			} else {
				parsedValues = values as unknown[][];
			}
			if (!parsedValues?.length)
				throw new Error("values must be a non-empty 2D list of cell values.");

			// Resolve sheet ID from table ID
			const metaUrl = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}`,
				{ fields: "sheets(properties(sheetId),tables(tableId))" },
			);
			const metaResp = (await sheetsFetch(
				accessToken,
				metaUrl,
			)) as SpreadsheetResponse;

			let sheetId: number | undefined;
			for (const sheet of metaResp.sheets ?? []) {
				for (const table of sheet.tables ?? []) {
					if (table.tableId === table_id) {
						sheetId = sheet.properties?.sheetId;
						break;
					}
				}
				if (sheetId !== undefined) break;
			}
			if (sheetId === undefined)
				throw new Error(
					`Table '${table_id}' not found in spreadsheet ${spreadsheet_id}. Use list_sheet_tables to find valid table IDs.`,
				);

			// Build appendCells request
			const rows = parsedValues.map((rowVals) => {
				if (!Array.isArray(rowVals))
					throw new Error(
						'Each row in values must be a list. Expected format: [["val1"], ["val2"]]',
					);
				return {
					values: (rowVals as unknown[]).map((v) => ({
						userEnteredValue: toExtendedValue(v),
					})),
				};
			});

			const batchUrl = `${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`;
			await sheetsFetch(accessToken, batchUrl, {
				method: "POST",
				body: JSON.stringify({
					requests: [
						{
							appendCells: {
								sheetId,
								tableId: table_id,
								rows,
								fields: "userEnteredValue",
							},
						},
					],
				}),
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Successfully appended ${parsedValues.length} row(s) to table '${table_id}' in spreadsheet ${spreadsheet_id}.`,
					},
				],
			};
		},
	);

	// ── 11. resize_sheet_dimensions ──────────────────────────────────────────
	server.tool(
		"resize_sheet_dimensions",
		"Resize columns/rows, auto-resize to fit content, freeze rows/columns, hide/unhide rows/columns, and insert/delete rows/columns in a sheet.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			sheet_name: z
				.string()
				.optional()
				.describe("Sheet name to target. Defaults to the first sheet."),
			column_sizes: z
				.union([z.string(), z.record(z.number())])
				.optional()
				.describe(
					'Dict (or JSON string) mapping column letters to pixel widths, e.g. {"A": 200, "C": 300}.',
				),
			row_sizes: z
				.union([z.string(), z.record(z.number())])
				.optional()
				.describe(
					'Dict (or JSON string) mapping 1-based row numbers to pixel heights, e.g. {"1": 40}.',
				),
			auto_resize_columns: z
				.union([z.string(), z.array(z.string())])
				.optional()
				.describe(
					'List (or JSON string) of column letters to auto-resize, e.g. ["A", "B"].',
				),
			auto_resize_rows: z
				.union([z.string(), z.array(z.number())])
				.optional()
				.describe(
					"List (or JSON string) of 1-based row numbers to auto-resize, e.g. [1, 2].",
				),
			frozen_row_count: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Number of rows to freeze from top. Use 0 to unfreeze all rows.",
				),
			frozen_column_count: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Number of columns to freeze from left. Use 0 to unfreeze all columns.",
				),
			hide_columns: z
				.union([z.string(), z.array(z.string())])
				.optional()
				.describe(
					'List (or JSON string) of column letters to hide, e.g. ["C", "D"].',
				),
			unhide_columns: z
				.union([z.string(), z.array(z.string())])
				.optional()
				.describe("List (or JSON string) of column letters to unhide."),
			hide_rows: z
				.union([z.string(), z.array(z.number())])
				.optional()
				.describe(
					"List (or JSON string) of 1-based row numbers to hide, e.g. [3, 4].",
				),
			unhide_rows: z
				.union([z.string(), z.array(z.number())])
				.optional()
				.describe("List (or JSON string) of 1-based row numbers to unhide."),
			insert_rows: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Number of rows to insert."),
			insert_rows_at: z
				.number()
				.int()
				.positive()
				.optional()
				.describe(
					"1-based row number to insert before. Appends to end if omitted.",
				),
			insert_columns: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Number of columns to insert."),
			insert_columns_at: z
				.string()
				.optional()
				.describe(
					"Column letter to insert before, e.g. 'C'. Appends to end if omitted.",
				),
			delete_rows: z
				.union([z.string(), z.array(z.number())])
				.optional()
				.describe(
					"List (or JSON string) of 1-based row numbers to delete. Best for non-contiguous rows.",
				),
			delete_row_range: z
				.string()
				.optional()
				.describe(
					"Contiguous row range to delete as 'start:end' (1-based, inclusive), e.g. '5:10'. More efficient than delete_rows for large ranges.",
				),
			delete_columns: z
				.union([z.string(), z.array(z.string())])
				.optional()
				.describe(
					'List (or JSON string) of column letters to delete, e.g. ["E", "F"].',
				),
		},
		async ({
			spreadsheet_id,
			sheet_name,
			column_sizes,
			row_sizes,
			auto_resize_columns,
			auto_resize_rows,
			frozen_row_count,
			frozen_column_count,
			hide_columns,
			unhide_columns,
			hide_rows,
			unhide_rows,
			insert_rows,
			insert_rows_at,
			insert_columns,
			insert_columns_at,
			delete_rows,
			delete_row_range,
			delete_columns,
		}) => {
			const hasAny =
				column_sizes !== undefined ||
				row_sizes !== undefined ||
				auto_resize_columns !== undefined ||
				auto_resize_rows !== undefined ||
				frozen_row_count !== undefined ||
				frozen_column_count !== undefined ||
				hide_columns !== undefined ||
				unhide_columns !== undefined ||
				hide_rows !== undefined ||
				unhide_rows !== undefined ||
				insert_rows !== undefined ||
				insert_columns !== undefined ||
				delete_rows !== undefined ||
				delete_row_range !== undefined ||
				delete_columns !== undefined;
			if (!hasAny)
				throw new Error(
					"Provide at least one of: column_sizes, row_sizes, auto_resize_columns, auto_resize_rows, frozen_row_count, frozen_column_count, hide_columns, unhide_columns, hide_rows, unhide_rows, insert_rows, insert_columns, delete_rows, delete_row_range, or delete_columns.",
				);

			const { accessToken } = await ctx.getService("gsheets");

			// Helper to parse JSON string parameters
			function parseJson<T>(v: unknown, name: string): T {
				if (typeof v !== "string") return v as T;
				try {
					return JSON.parse(v) as T;
				} catch {
					throw new Error(`Invalid JSON for ${name}.`);
				}
			}

			const colSizes =
				column_sizes !== undefined
					? parseJson<Record<string, number>>(column_sizes, "column_sizes")
					: undefined;
			const rowSizes =
				row_sizes !== undefined
					? parseJson<Record<string, number>>(row_sizes, "row_sizes")
					: undefined;
			const autoResizeCols =
				auto_resize_columns !== undefined
					? parseJson<string[]>(auto_resize_columns, "auto_resize_columns")
					: undefined;
			const autoResizeRows =
				auto_resize_rows !== undefined
					? parseJson<number[]>(auto_resize_rows, "auto_resize_rows")
					: undefined;
			const hideCols =
				hide_columns !== undefined
					? parseJson<string[]>(hide_columns, "hide_columns")
					: undefined;
			const unhideCols =
				unhide_columns !== undefined
					? parseJson<string[]>(unhide_columns, "unhide_columns")
					: undefined;
			const hideRowsList =
				hide_rows !== undefined
					? parseJson<number[]>(hide_rows, "hide_rows")
					: undefined;
			const unhideRowsList =
				unhide_rows !== undefined
					? parseJson<number[]>(unhide_rows, "unhide_rows")
					: undefined;
			const deleteRowsList =
				delete_rows !== undefined
					? parseJson<number[]>(delete_rows, "delete_rows")
					: undefined;
			const deleteCols =
				delete_columns !== undefined
					? parseJson<string[]>(delete_columns, "delete_columns")
					: undefined;

			// Fetch sheet metadata
			const metaUrl = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}`,
				{ fields: "sheets(properties(sheetId,title))" },
			);
			const metaResp = (await sheetsFetch(
				accessToken,
				metaUrl,
			)) as SpreadsheetResponse;
			const sheets = metaResp.sheets ?? [];
			if (!sheets.length) throw new Error("No sheets found in spreadsheet.");

			const targetSheet = selectSheet(sheets, sheet_name);
			const sheetId = targetSheet.properties?.sheetId ?? 0;

			const requests: unknown[] = [];
			const appliedParts: string[] = [];

			// Column resize requests
			if (colSizes) {
				if (typeof colSizes !== "object" || Array.isArray(colSizes))
					throw new Error(
						"column_sizes must be a dict mapping column letters to pixel widths.",
					);
				for (const [letter, size] of Object.entries(colSizes)) {
					const idx = columnToIndex(letter.toUpperCase());
					if (idx === null)
						throw new Error(`Invalid column letter: '${letter}'.`);
					if (typeof size !== "number" || size <= 0)
						throw new Error(
							`Pixel size for column '${letter}' must be a positive number.`,
						);
					requests.push({
						updateDimensionProperties: {
							range: {
								sheetId,
								dimension: "COLUMNS",
								startIndex: idx,
								endIndex: idx + 1,
							},
							properties: { pixelSize: Math.round(size) },
							fields: "pixelSize",
						},
					});
				}
				appliedParts.push(
					`resized columns: ${Object.entries(colSizes)
						.map(([k, v]) => `${k}=${v}px`)
						.join(", ")}`,
				);
			}

			// Row resize requests
			if (rowSizes) {
				if (typeof rowSizes !== "object" || Array.isArray(rowSizes))
					throw new Error(
						"row_sizes must be a dict mapping row numbers to pixel heights.",
					);
				for (const [rowStr, size] of Object.entries(rowSizes)) {
					const rowNum = parseInt(rowStr, 10);
					if (Number.isNaN(rowNum) || rowNum < 1)
						throw new Error(
							`Row number must be an integer >= 1, got ${rowStr}.`,
						);
					if (typeof size !== "number" || size <= 0)
						throw new Error(
							`Pixel size for row ${rowNum} must be a positive number.`,
						);
					requests.push({
						updateDimensionProperties: {
							range: {
								sheetId,
								dimension: "ROWS",
								startIndex: rowNum - 1,
								endIndex: rowNum,
							},
							properties: { pixelSize: Math.round(size) },
							fields: "pixelSize",
						},
					});
				}
				appliedParts.push(
					`resized rows: ${Object.entries(rowSizes)
						.map(([k, v]) => `${k}=${v}px`)
						.join(", ")}`,
				);
			}

			// Auto-resize column requests
			if (autoResizeCols) {
				if (!Array.isArray(autoResizeCols))
					throw new Error(
						"auto_resize_columns must be a list of column letters.",
					);
				for (const letter of autoResizeCols) {
					const idx = columnToIndex(String(letter).toUpperCase());
					if (idx === null)
						throw new Error(`Invalid column letter: '${letter}'.`);
					requests.push({
						autoResizeDimensions: {
							dimensions: {
								sheetId,
								dimension: "COLUMNS",
								startIndex: idx,
								endIndex: idx + 1,
							},
						},
					});
				}
				appliedParts.push(`auto-resized columns: ${autoResizeCols.join(", ")}`);
			}

			// Auto-resize row requests
			if (autoResizeRows) {
				if (!Array.isArray(autoResizeRows))
					throw new Error("auto_resize_rows must be a list of row numbers.");
				for (const rn of autoResizeRows) {
					const rowNum = parseInt(String(rn), 10);
					if (Number.isNaN(rowNum) || rowNum < 1)
						throw new Error(`Row number must be an integer >= 1, got ${rn}.`);
					requests.push({
						autoResizeDimensions: {
							dimensions: {
								sheetId,
								dimension: "ROWS",
								startIndex: rowNum - 1,
								endIndex: rowNum,
							},
						},
					});
				}
				appliedParts.push(`auto-resized rows: ${autoResizeRows.join(", ")}`);
			}

			// Freeze requests
			const gridProperties: Record<string, number> = {};
			const gridFields: string[] = [];
			if (frozen_row_count !== undefined) {
				gridProperties.frozenRowCount = frozen_row_count;
				gridFields.push("gridProperties.frozenRowCount");
				appliedParts.push(
					frozen_row_count > 0
						? `froze ${frozen_row_count} row(s)`
						: "unfroze rows",
				);
			}
			if (frozen_column_count !== undefined) {
				gridProperties.frozenColumnCount = frozen_column_count;
				gridFields.push("gridProperties.frozenColumnCount");
				appliedParts.push(
					frozen_column_count > 0
						? `froze ${frozen_column_count} column(s)`
						: "unfroze columns",
				);
			}
			if (gridFields.length) {
				requests.push({
					updateSheetProperties: {
						properties: { sheetId, gridProperties },
						fields: gridFields.join(","),
					},
				});
			}

			// Hide/unhide columns
			const buildColVisibility = (
				letters: string[],
				hidden: boolean,
				label: string,
			) => {
				if (!Array.isArray(letters))
					throw new Error(`${label} must be a list of column letters.`);
				return letters.map((l) => {
					const idx = columnToIndex(String(l).toUpperCase());
					if (idx === null)
						throw new Error(`Invalid column letter in ${label}: '${l}'.`);
					return {
						updateDimensionProperties: {
							range: {
								sheetId,
								dimension: "COLUMNS",
								startIndex: idx,
								endIndex: idx + 1,
							},
							properties: { hiddenByUser: hidden },
							fields: "hiddenByUser",
						},
					};
				});
			};
			if (hideCols) {
				requests.push(...buildColVisibility(hideCols, true, "hide_columns"));
				appliedParts.push(`hid columns: ${hideCols.join(", ")}`);
			}
			if (unhideCols) {
				requests.push(
					...buildColVisibility(unhideCols, false, "unhide_columns"),
				);
				appliedParts.push(`unhid columns: ${unhideCols.join(", ")}`);
			}

			// Hide/unhide rows
			const buildRowVisibility = (
				rowNums: number[],
				hidden: boolean,
				label: string,
			) => {
				if (!Array.isArray(rowNums))
					throw new Error(`${label} must be a list of row numbers.`);
				return rowNums.map((rn) => {
					const n = parseInt(String(rn), 10);
					if (Number.isNaN(n) || n < 1)
						throw new Error(`Row number must be >= 1 in ${label}, got ${rn}.`);
					return {
						updateDimensionProperties: {
							range: {
								sheetId,
								dimension: "ROWS",
								startIndex: n - 1,
								endIndex: n,
							},
							properties: { hiddenByUser: hidden },
							fields: "hiddenByUser",
						},
					};
				});
			};
			if (hideRowsList) {
				requests.push(...buildRowVisibility(hideRowsList, true, "hide_rows"));
				appliedParts.push(`hid rows: ${hideRowsList.join(", ")}`);
			}
			if (unhideRowsList) {
				requests.push(
					...buildRowVisibility(unhideRowsList, false, "unhide_rows"),
				);
				appliedParts.push(`unhid rows: ${unhideRowsList.join(", ")}`);
			}

			// Insert rows
			if (insert_rows !== undefined) {
				if (insert_rows_at !== undefined) {
					const startIdx = insert_rows_at - 1;
					requests.push({
						insertDimension: {
							range: {
								sheetId,
								dimension: "ROWS",
								startIndex: startIdx,
								endIndex: startIdx + insert_rows,
							},
							inheritFromBefore: startIdx > 0,
						},
					});
					appliedParts.push(
						`inserted ${insert_rows} row(s) at row ${insert_rows_at}`,
					);
				} else {
					requests.push({
						appendDimension: {
							sheetId,
							dimension: "ROWS",
							length: insert_rows,
						},
					});
					appliedParts.push(`appended ${insert_rows} row(s)`);
				}
			}

			// Insert columns
			if (insert_columns !== undefined) {
				if (insert_columns_at !== undefined) {
					const colIdx = columnToIndex(insert_columns_at.toUpperCase());
					if (colIdx === null)
						throw new Error(
							`Invalid column letter for insert_columns_at: '${insert_columns_at}'.`,
						);
					requests.push({
						insertDimension: {
							range: {
								sheetId,
								dimension: "COLUMNS",
								startIndex: colIdx,
								endIndex: colIdx + insert_columns,
							},
							inheritFromBefore: colIdx > 0,
						},
					});
					appliedParts.push(
						`inserted ${insert_columns} column(s) at column ${insert_columns_at}`,
					);
				} else {
					requests.push({
						appendDimension: {
							sheetId,
							dimension: "COLUMNS",
							length: insert_columns,
						},
					});
					appliedParts.push(`appended ${insert_columns} column(s)`);
				}
			}

			// Reject mixing delete_rows and delete_row_range
			if (deleteRowsList && delete_row_range)
				throw new Error(
					"delete_rows and delete_row_range cannot be used together.",
				);

			// Delete rows (reverse order to preserve indices)
			if (deleteRowsList) {
				if (!Array.isArray(deleteRowsList))
					throw new Error("delete_rows must be a list of row numbers.");
				const sorted = [...deleteRowsList]
					.map((r) => parseInt(String(r), 10))
					.sort((a, b) => b - a);
				for (const rn of sorted) {
					if (rn < 1)
						throw new Error(
							`Row number must be >= 1 in delete_rows, got ${rn}.`,
						);
					requests.push({
						deleteDimension: {
							range: {
								sheetId,
								dimension: "ROWS",
								startIndex: rn - 1,
								endIndex: rn,
							},
						},
					});
				}
				appliedParts.push(`deleted rows: ${deleteRowsList.join(", ")}`);
			}

			// Delete row range (contiguous)
			if (delete_row_range) {
				if (!delete_row_range.includes(":"))
					throw new Error(
						`delete_row_range must be a 'start:end' string (e.g. '5:10'), got: '${delete_row_range}'.`,
					);
				const [startStr, endStr] = delete_row_range.split(":", 2);
				const rangeStart = parseInt(startStr, 10);
				const rangeEnd = parseInt(endStr, 10);
				if (Number.isNaN(rangeStart) || Number.isNaN(rangeEnd))
					throw new Error(
						`Invalid delete_row_range format: '${delete_row_range}'. Expected 'start:end' with integer row numbers.`,
					);
				if (rangeStart < 1 || rangeEnd < rangeStart)
					throw new Error(
						`Invalid row range: start=${rangeStart}, end=${rangeEnd}. Rows are 1-based and end must be >= start.`,
					);
				requests.push({
					deleteDimension: {
						range: {
							sheetId,
							dimension: "ROWS",
							startIndex: rangeStart - 1,
							endIndex: rangeEnd,
						},
					},
				});
				appliedParts.push(
					`deleted row range ${rangeStart}-${rangeEnd} (${rangeEnd - rangeStart + 1} row(s))`,
				);
			}

			// Delete columns (reverse order)
			if (deleteCols) {
				if (!Array.isArray(deleteCols))
					throw new Error("delete_columns must be a list of column letters.");
				const colIdxPairs: [string, number][] = deleteCols.map((l) => {
					const idx = columnToIndex(String(l).toUpperCase());
					if (idx === null)
						throw new Error(`Invalid column letter in delete_columns: '${l}'.`);
					return [l, idx];
				});
				colIdxPairs.sort((a, b) => b[1] - a[1]);
				for (const [, idx] of colIdxPairs) {
					requests.push({
						deleteDimension: {
							range: {
								sheetId,
								dimension: "COLUMNS",
								startIndex: idx,
								endIndex: idx + 1,
							},
						},
					});
				}
				appliedParts.push(`deleted columns: ${deleteCols.join(", ")}`);
			}

			const batchUrl = `${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`;
			await sheetsFetch(accessToken, batchUrl, {
				method: "POST",
				body: JSON.stringify({ requests }),
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Applied dimension changes in spreadsheet ${spreadsheet_id}: ${appliedParts.join("; ")}.`,
					},
				],
			};
		},
	);

	// ── 12. move_sheet_rows ───────────────────────────────────────────────────
	server.tool(
		"move_sheet_rows",
		"Move rows from one sheet to another within the same spreadsheet. Preserves formulas, data types, and formatting.",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			source_sheet: z.string().describe("Name of the sheet to move rows from."),
			start_row: z
				.number()
				.int()
				.positive()
				.describe("First row to move (1-based, inclusive)."),
			end_row: z
				.number()
				.int()
				.positive()
				.describe("Last row to move (1-based, inclusive)."),
			destination_sheet: z
				.string()
				.describe("Name of the sheet to move rows to."),
		},
		async ({
			spreadsheet_id,
			source_sheet,
			start_row,
			end_row,
			destination_sheet,
		}) => {
			const { accessToken } = await ctx.getService("gsheets");

			if (start_row < 1 || end_row < start_row)
				throw new Error(
					`Invalid row range: start_row=${start_row}, end_row=${end_row}. Rows are 1-based and end_row must be >= start_row.`,
				);
			if (source_sheet === destination_sheet)
				throw new Error(
					"source_sheet and destination_sheet must be different.",
				);

			// Get sheet metadata including gridProperties
			const metaUrl = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}`,
				{ fields: "sheets(properties(sheetId,title,gridProperties))" },
			);
			const metaResp = (await sheetsFetch(
				accessToken,
				metaUrl,
			)) as SpreadsheetResponse;
			const sheets = metaResp.sheets ?? [];

			const srcSheet = selectSheet(sheets, source_sheet);
			const dstSheet = selectSheet(sheets, destination_sheet);
			const srcId = srcSheet.properties?.sheetId ?? 0;
			const dstId = dstSheet.properties?.sheetId ?? 0;
			const dstGridRows = dstSheet.properties?.gridProperties?.rowCount ?? 0;

			// Validate source has data
			const safeSource = source_sheet.replace(/'/g, "''");
			const srcRangeEncoded = encodeURIComponent(
				`'${safeSource}'!${start_row}:${end_row}`,
			);
			const srcValUrl = `${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${srcRangeEncoded}`;
			const srcVals = (await sheetsFetch(
				accessToken,
				srcValUrl,
			)) as ValueRangeResponse;
			if (!srcVals.values?.length)
				throw new Error(
					`Source range '${source_sheet}' rows ${start_row}-${end_row} contains no data. Nothing to move.`,
				);

			// Find last data row in destination
			const safeDst = destination_sheet.replace(/'/g, "''");
			const dstRangeEncoded = encodeURIComponent(`'${safeDst}'`);
			const dstValUrl = buildUrl(
				`${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}/values/${dstRangeEncoded}`,
				{ majorDimension: "ROWS" },
			);
			const dstVals = (await sheetsFetch(
				accessToken,
				dstValUrl,
			)) as ValueRangeResponse;
			const dstDataRows = dstVals.values?.length ?? 0;

			const numRows = end_row - start_row + 1;
			const pasteStart = dstDataRows;
			const requests: unknown[] = [];

			// Expand destination grid if needed
			if (pasteStart + numRows > dstGridRows) {
				requests.push({
					appendDimension: {
						sheetId: dstId,
						dimension: "ROWS",
						length: pasteStart + numRows - dstGridRows,
					},
				});
			}

			requests.push(
				{
					copyPaste: {
						source: {
							sheetId: srcId,
							startRowIndex: start_row - 1,
							endRowIndex: end_row,
						},
						destination: {
							sheetId: dstId,
							startRowIndex: pasteStart,
							endRowIndex: pasteStart + numRows,
						},
						pasteType: "PASTE_NORMAL",
					},
				},
				{
					deleteDimension: {
						range: {
							sheetId: srcId,
							dimension: "ROWS",
							startIndex: start_row - 1,
							endIndex: end_row,
						},
					},
				},
			);

			const batchUrl = `${SHEETS_BASE}/spreadsheets/${encodeURIComponent(spreadsheet_id)}:batchUpdate`;
			await sheetsFetch(accessToken, batchUrl, {
				method: "POST",
				body: JSON.stringify({ requests }),
			});

			return {
				content: [
					{
						type: "text" as const,
						text: `Successfully moved ${numRows} row(s) from '${source_sheet}' (rows ${start_row}-${end_row}) to '${destination_sheet}' in spreadsheet ${spreadsheet_id}.`,
					},
				],
			};
		},
	);

	// ── 13. list_spreadsheet_comments ─────────────────────────────────────────
	server.tool(
		"list_spreadsheet_comments",
		"List comments on a Google Spreadsheet (uses Drive API).",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			max_comments: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Maximum number of comments to return. Defaults to 100."),
		},
		async ({ spreadsheet_id, max_comments }) => {
			const { accessToken } = await ctx.getService("gsheets");
			const limit = max_comments ?? 100;
			const text = await readCommentsImpl(
				accessToken,
				spreadsheet_id,
				"spreadsheet",
				limit,
			);
			return { content: [{ type: "text" as const, text }] };
		},
	);

	// ── 14. manage_spreadsheet_comment ────────────────────────────────────────
	server.tool(
		"manage_spreadsheet_comment",
		"Create, reply to, or resolve a comment on a Google Spreadsheet (uses Drive API).",
		{
			spreadsheet_id: z.string().describe("The ID of the spreadsheet."),
			action: z
				.enum(["create", "reply", "resolve"])
				.describe(
					"Action to perform: create a new comment, reply to one, or resolve one.",
				),
			comment_content: z
				.string()
				.optional()
				.describe("Comment or reply text. Required for 'create' and 'reply'."),
			comment_id: z
				.string()
				.optional()
				.describe(
					"ID of the comment to reply to or resolve. Required for 'reply' and 'resolve'.",
				),
		},
		async ({ spreadsheet_id, action, comment_content, comment_id }) => {
			const { accessToken } = await ctx.getService("gsheets");
			const fileId = spreadsheet_id;

			if (action === "create") {
				if (!comment_content)
					throw new Error("comment_content is required for create action.");
				const url = buildUrl(
					`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments`,
					{
						fields: "id,content,author,createdTime,modifiedTime",
					},
				);
				const resp = (await sheetsFetch(accessToken, url, {
					method: "POST",
					body: JSON.stringify({ content: comment_content }),
				})) as DriveComment;
				return {
					content: [
						{
							type: "text" as const,
							text: `Comment created successfully!\nComment ID: ${resp.id ?? ""}\nAuthor: ${resp.author?.displayName ?? "Unknown"}\nCreated: ${resp.createdTime ?? ""}\nContent: ${comment_content}`,
						},
					],
				};
			}

			if (action === "reply") {
				if (!comment_id || !comment_content)
					throw new Error(
						"comment_id and comment_content are required for reply action.",
					);
				const url = buildUrl(
					`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(comment_id)}/replies`,
					{ fields: "id,content,author,createdTime,modifiedTime" },
				);
				const resp = (await sheetsFetch(accessToken, url, {
					method: "POST",
					body: JSON.stringify({ content: comment_content }),
				})) as {
					id?: string;
					author?: { displayName?: string };
					createdTime?: string;
				};
				return {
					content: [
						{
							type: "text" as const,
							text: `Reply posted successfully!\nReply ID: ${resp.id ?? ""}\nAuthor: ${resp.author?.displayName ?? "Unknown"}\nCreated: ${resp.createdTime ?? ""}\nContent: ${comment_content}`,
						},
					],
				};
			}

			// action === "resolve"
			if (!comment_id)
				throw new Error("comment_id is required for resolve action.");
			const url = buildUrl(
				`${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(comment_id)}/replies`,
				{ fields: "id,content,author,createdTime,modifiedTime" },
			);
			const resp = (await sheetsFetch(accessToken, url, {
				method: "POST",
				body: JSON.stringify({
					content: "This comment has been resolved.",
					action: "resolve",
				}),
			})) as {
				id?: string;
				author?: { displayName?: string };
				createdTime?: string;
			};
			return {
				content: [
					{
						type: "text" as const,
						text: `Comment ${comment_id} has been resolved successfully.\nResolve reply ID: ${resp.id ?? ""}\nAuthor: ${resp.author?.displayName ?? "Unknown"}\nCreated: ${resp.createdTime ?? ""}`,
					},
				],
			};
		},
	);
}
