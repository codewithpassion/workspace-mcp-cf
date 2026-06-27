// gdocs-helpers.ts — Shared types and request-builder utilities for Google Docs tools.
// No tool registrations here; imported by gdocs.ts.

// ─── Minimal API response types ───────────────────────────────────────────────

export interface DocTextStyle {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	fontSize?: { magnitude?: number; unit?: string };
	weightedFontFamily?: { fontFamily?: string; weight?: number };
	foregroundColor?: {
		color?: { rgbColor?: { red?: number; green?: number; blue?: number } };
	};
	link?: { url?: string } | null;
	baselineOffset?: string;
}

export interface DocTextRun {
	content?: string;
	textStyle?: DocTextStyle;
}

export interface DocParagraphElement {
	startIndex?: number;
	endIndex?: number;
	textRun?: DocTextRun;
}

export interface DocParagraphStyle {
	namedStyleType?: string;
	alignment?: string;
	headingId?: string;
	bulletPreset?: string;
}

export interface DocBullet {
	nestingLevel?: number;
	listId?: string;
}

export interface DocParagraph {
	elements?: DocParagraphElement[];
	paragraphStyle?: DocParagraphStyle;
	bullet?: DocBullet;
}

export interface DocTableCell {
	startIndex?: number;
	endIndex?: number;
	content?: DocBodyElement[];
}

export interface DocTableRow {
	startIndex?: number;
	endIndex?: number;
	tableCells?: DocTableCell[];
}

export interface DocTable {
	rows?: number;
	columns?: number;
	tableRows?: DocTableRow[];
}

export interface DocSectionBreak {
	sectionStyle?: Record<string, unknown>;
}

export interface DocBodyElement {
	startIndex?: number;
	endIndex?: number;
	paragraph?: DocParagraph;
	table?: DocTable;
	sectionBreak?: DocSectionBreak;
}

export interface DocBody {
	content?: DocBodyElement[];
}

export interface DocDocumentTab {
	body?: DocBody;
	headers?: Record<string, unknown>;
	footers?: Record<string, unknown>;
	documentStyle?: Record<string, unknown>;
	namedRanges?: Record<string, unknown>;
}

export interface DocTab {
	tabProperties?: { tabId?: string; title?: string };
	documentTab?: DocDocumentTab;
	childTabs?: DocTab[];
}

export interface DocumentResponse {
	documentId?: string;
	title?: string;
	body?: DocBody;
	tabs?: DocTab[];
	headers?: Record<string, unknown>;
	footers?: Record<string, unknown>;
	documentStyle?: Record<string, unknown>;
	namedRanges?: Record<string, unknown>;
}

// ─── URL builder ──────────────────────────────────────────────────────────────

export function buildUrl(
	base: string,
	params: Record<string, string | number | boolean | null | undefined>,
): string {
	const url = new URL(base);
	for (const [k, v] of Object.entries(params)) {
		if (v !== null && v !== undefined) url.searchParams.set(k, String(v));
	}
	return url.toString();
}

// ─── Color helper ──────────────────────────────────────────────────────────────

export function hexToColor(hex: string): {
	red: number;
	green: number;
	blue: number;
} {
	const clean = hex.replace(/^#/, "");
	return {
		red: Number.parseInt(clean.slice(0, 2), 16) / 255,
		green: Number.parseInt(clean.slice(2, 4), 16) / 255,
		blue: Number.parseInt(clean.slice(4, 6), 16) / 255,
	};
}

// ─── Location / range builders ────────────────────────────────────────────────

export function buildLocation(
	index: number,
	tabId?: string,
	segmentId?: string,
): Record<string, unknown> {
	const loc: Record<string, unknown> = { index };
	if (tabId) loc.tabId = tabId;
	if (segmentId) loc.segmentId = segmentId;
	return loc;
}

export function buildEndOfSegmentLocation(
	tabId?: string,
	segmentId?: string,
): Record<string, unknown> {
	const loc: Record<string, unknown> = { segmentId: segmentId ?? "" };
	if (tabId) loc.tabId = tabId;
	return loc;
}

export function buildRange(
	startIndex: number,
	endIndex: number,
	tabId?: string,
	segmentId?: string,
): Record<string, unknown> {
	const r: Record<string, unknown> = { startIndex, endIndex };
	if (tabId) r.tabId = tabId;
	if (segmentId) r.segmentId = segmentId;
	return r;
}

export function buildTableCellLocation(
	tableStartIndex: number,
	rowIndex: number,
	columnIndex: number,
	tabId?: string,
): Record<string, unknown> {
	const loc: Record<string, unknown> = {
		tableStartLocation: buildLocation(tableStartIndex, tabId),
		rowIndex,
		columnIndex,
	};
	return loc;
}

export function buildTableRange(
	tableStartIndex: number,
	rowIndex: number,
	columnIndex: number,
	rowSpan: number,
	columnSpan: number,
	tabId?: string,
): Record<string, unknown> {
	return {
		tableCellLocation: buildTableCellLocation(
			tableStartIndex,
			rowIndex,
			columnIndex,
			tabId,
		),
		rowSpan,
		columnSpan,
	};
}

// ─── TextStyle builder ────────────────────────────────────────────────────────

export function buildTextStyleAndFields(op: Record<string, unknown>): {
	textStyle: Record<string, unknown>;
	fields: string;
} {
	const style: Record<string, unknown> = {};
	const fields: string[] = [];

	if (op.bold !== undefined) {
		style.bold = op.bold;
		fields.push("bold");
	}
	if (op.italic !== undefined) {
		style.italic = op.italic;
		fields.push("italic");
	}
	if (op.underline !== undefined) {
		style.underline = op.underline;
		fields.push("underline");
	}
	if (op.strikethrough !== undefined) {
		style.strikethrough = op.strikethrough;
		fields.push("strikethrough");
	}
	if (op.small_caps !== undefined) {
		style.smallCaps = op.small_caps;
		fields.push("smallCaps");
	}
	if (op.font_size !== undefined) {
		style.fontSize = { magnitude: op.font_size, unit: "PT" };
		fields.push("fontSize");
	}
	if (op.font_family !== undefined) {
		const wff: Record<string, unknown> = { fontFamily: op.font_family };
		if (op.font_weight !== undefined) wff.weight = op.font_weight;
		style.weightedFontFamily = wff;
		fields.push("weightedFontFamily");
	}
	if (op.text_color !== undefined && typeof op.text_color === "string") {
		style.foregroundColor = { color: { rgbColor: hexToColor(op.text_color) } };
		fields.push("foregroundColor");
	}
	if (
		op.background_color !== undefined &&
		typeof op.background_color === "string"
	) {
		style.backgroundColor = {
			color: { rgbColor: hexToColor(op.background_color) },
		};
		fields.push("backgroundColor");
	}
	if (op.link_url !== undefined && typeof op.link_url === "string") {
		style.link = { url: op.link_url };
		fields.push("link");
	}
	if (op.clear_link === true) {
		style.link = null;
		fields.push("link");
	}
	if (op.baseline_offset !== undefined) {
		style.baselineOffset = op.baseline_offset;
		fields.push("baselineOffset");
	}
	return { textStyle: style, fields: fields.join(",") };
}

// ─── ParagraphStyle builder ───────────────────────────────────────────────────

const HEADING_LEVEL_MAP: Record<number, string> = {
	0: "NORMAL_TEXT",
	1: "HEADING_1",
	2: "HEADING_2",
	3: "HEADING_3",
	4: "HEADING_4",
	5: "HEADING_5",
	6: "HEADING_6",
};

const BULLET_PRESET_MAP: Record<string, string> = {
	UNORDERED: "BULLET_DISC_CIRCLE_SQUARE",
	ORDERED: "NUMBERED_DECIMAL_ALPHA_ROMAN",
	CHECKBOX: "BULLET_CHECKBOX",
};

export function buildParagraphStyleAndFields(op: Record<string, unknown>): {
	paragraphStyle: Record<string, unknown>;
	fields: string;
} {
	const style: Record<string, unknown> = {};
	const fields: string[] = [];

	const headingLevel = op.heading_level as number | undefined;
	const namedStyleType = op.named_style_type as string | undefined;

	if (headingLevel !== undefined) {
		style.namedStyleType = HEADING_LEVEL_MAP[headingLevel] ?? "NORMAL_TEXT";
		fields.push("namedStyleType");
	} else if (namedStyleType !== undefined) {
		style.namedStyleType = namedStyleType;
		fields.push("namedStyleType");
	}
	if (op.alignment !== undefined) {
		style.alignment = op.alignment;
		fields.push("alignment");
	}
	if (op.line_spacing !== undefined) {
		style.lineSpacing = (op.line_spacing as number) * 100;
		fields.push("lineSpacing");
	}
	if (op.indent_first_line !== undefined) {
		style.indentFirstLine = { magnitude: op.indent_first_line, unit: "PT" };
		fields.push("indentFirstLine");
	}
	if (op.indent_start !== undefined) {
		style.indentStart = { magnitude: op.indent_start, unit: "PT" };
		fields.push("indentStart");
	}
	if (op.indent_end !== undefined) {
		style.indentEnd = { magnitude: op.indent_end, unit: "PT" };
		fields.push("indentEnd");
	}
	if (op.space_above !== undefined) {
		style.spaceAbove = { magnitude: op.space_above, unit: "PT" };
		fields.push("spaceAbove");
	}
	if (op.space_below !== undefined) {
		style.spaceBelow = { magnitude: op.space_below, unit: "PT" };
		fields.push("spaceBelow");
	}
	if (op.direction !== undefined) {
		style.direction = op.direction;
		fields.push("direction");
	}
	if (op.keep_lines_together !== undefined) {
		style.keepLinesTogether = op.keep_lines_together;
		fields.push("keepLinesTogether");
	}
	if (op.keep_with_next !== undefined) {
		style.keepWithNext = op.keep_with_next;
		fields.push("keepWithNext");
	}
	if (op.avoid_widow_and_orphan !== undefined) {
		style.avoidWidowAndOrphan = op.avoid_widow_and_orphan;
		fields.push("avoidWidowAndOrphan");
	}
	if (op.page_break_before !== undefined) {
		style.pageBreakBefore = op.page_break_before;
		fields.push("pageBreakBefore");
	}
	if (op.spacing_mode !== undefined) {
		style.spacingMode = op.spacing_mode;
		fields.push("spacingMode");
	}
	if (op.shading_color !== undefined && typeof op.shading_color === "string") {
		style.shading = {
			backgroundColor: { color: { rgbColor: hexToColor(op.shading_color) } },
		};
		fields.push("shading");
	}
	return { paragraphStyle: style, fields: fields.join(",") };
}

// ─── batch_update_doc operation converter ─────────────────────────────────────

export function operationToRequests(op: Record<string, unknown>): unknown[] {
	const type = op.type as string;
	const tabId = op.tab_id as string | undefined;
	const segmentId = op.segment_id as string | undefined;

	switch (type) {
		case "insert_text": {
			const text = String(op.text ?? "");
			const endOfSegment = op.end_of_segment === true;
			if (endOfSegment) {
				return [
					{
						insertText: {
							endOfSegmentLocation: buildEndOfSegmentLocation(tabId, segmentId),
							text,
						},
					},
				];
			}
			const index = (op.index as number | undefined) ?? 1;
			return [
				{
					insertText: {
						location: buildLocation(index, tabId, segmentId),
						text,
					},
				},
			];
		}

		case "delete_text":
			return [
				{
					deleteContentRange: {
						range: buildRange(
							op.start_index as number,
							op.end_index as number,
							tabId,
							segmentId,
						),
					},
				},
			];

		case "replace_text": {
			const si = op.start_index as number;
			const ei = op.end_index as number;
			const text = String(op.text ?? "");
			return [
				{ deleteContentRange: { range: buildRange(si, ei, tabId, segmentId) } },
				{ insertText: { location: buildLocation(si, tabId, segmentId), text } },
			];
		}

		case "format_text": {
			const { textStyle, fields } = buildTextStyleAndFields(op);
			if (!fields) return [];
			return [
				{
					updateTextStyle: {
						range: buildRange(
							op.start_index as number,
							op.end_index as number,
							tabId,
							segmentId,
						),
						textStyle,
						fields,
					},
				},
			];
		}

		case "update_paragraph_style": {
			const reqs: unknown[] = [];
			const { paragraphStyle, fields } = buildParagraphStyleAndFields(op);
			if (fields) {
				reqs.push({
					updateParagraphStyle: {
						range: buildRange(
							op.start_index as number,
							op.end_index as number,
							tabId,
							segmentId,
						),
						paragraphStyle,
						fields,
					},
				});
			}
			const listType = op.list_type as string | undefined;
			if (listType) {
				if (listType === "NONE") {
					reqs.push({
						deleteParagraphBullets: {
							range: buildRange(
								op.start_index as number,
								op.end_index as number,
								tabId,
								segmentId,
							),
						},
					});
				} else {
					const preset =
						(op.bullet_preset as string | undefined) ??
						BULLET_PRESET_MAP[listType.toUpperCase()] ??
						"BULLET_DISC_CIRCLE_SQUARE";
					reqs.push({
						createParagraphBullets: {
							range: buildRange(
								op.start_index as number,
								op.end_index as number,
								tabId,
								segmentId,
							),
							bulletPreset: preset,
						},
					});
				}
			}
			return reqs;
		}

		case "update_table_cell_style": {
			const tableStartIndex = op.table_start_index as number;
			const tableCellStyle: Record<string, unknown> = {};
			const fields: string[] = [];
			if (op.background_color && typeof op.background_color === "string") {
				tableCellStyle.backgroundColor = {
					color: { rgbColor: hexToColor(op.background_color) },
				};
				fields.push("backgroundColor");
			}
			if (op.content_alignment) {
				tableCellStyle.contentAlignment = op.content_alignment;
				fields.push("contentAlignment");
			}
			if (op.padding_top !== undefined) {
				tableCellStyle.paddingTop = { magnitude: op.padding_top, unit: "PT" };
				fields.push("paddingTop");
			}
			if (op.padding_bottom !== undefined) {
				tableCellStyle.paddingBottom = {
					magnitude: op.padding_bottom,
					unit: "PT",
				};
				fields.push("paddingBottom");
			}
			if (op.padding_left !== undefined) {
				tableCellStyle.paddingLeft = { magnitude: op.padding_left, unit: "PT" };
				fields.push("paddingLeft");
			}
			if (op.padding_right !== undefined) {
				tableCellStyle.paddingRight = {
					magnitude: op.padding_right,
					unit: "PT",
				};
				fields.push("paddingRight");
			}
			if (op.border_color && typeof op.border_color === "string") {
				const borderColor = {
					color: { rgbColor: hexToColor(op.border_color) },
				};
				tableCellStyle.borderLeft = {
					color: borderColor,
					width: { magnitude: op.border_width ?? 1, unit: "PT" },
					dashStyle: "SOLID",
				};
				tableCellStyle.borderRight = {
					color: borderColor,
					width: { magnitude: op.border_width ?? 1, unit: "PT" },
					dashStyle: "SOLID",
				};
				tableCellStyle.borderTop = {
					color: borderColor,
					width: { magnitude: op.border_width ?? 1, unit: "PT" },
					dashStyle: "SOLID",
				};
				tableCellStyle.borderBottom = {
					color: borderColor,
					width: { magnitude: op.border_width ?? 1, unit: "PT" },
					dashStyle: "SOLID",
				};
				fields.push("borderLeft", "borderRight", "borderTop", "borderBottom");
			}
			if (!fields.length) return [];
			const req: Record<string, unknown> = {
				updateTableCellStyle: {
					tableStartLocation: buildLocation(tableStartIndex, tabId),
					tableCellStyle,
					fields: fields.join(","),
				},
			};
			if (op.row_index !== undefined && op.column_index !== undefined) {
				(req.updateTableCellStyle as Record<string, unknown>).tableRange =
					buildTableRange(
						tableStartIndex,
						op.row_index as number,
						op.column_index as number,
						(op.row_span as number | undefined) ?? 1,
						(op.column_span as number | undefined) ?? 1,
						tabId,
					);
			}
			return [req];
		}

		case "insert_table": {
			const rows = op.rows as number;
			const columns = op.columns as number;
			if (op.end_of_segment) {
				return [
					{
						insertTable: {
							rows,
							columns,
							endOfSegmentLocation: buildEndOfSegmentLocation(tabId, segmentId),
						},
					},
				];
			}
			const index = (op.index as number | undefined) ?? 1;
			return [
				{
					insertTable: {
						rows,
						columns,
						location: buildLocation(index, tabId, segmentId),
					},
				},
			];
		}

		case "insert_table_row": {
			const insertBelow = op.insert_below !== false;
			return [
				{
					insertTableRow: {
						tableCellLocation: buildTableCellLocation(
							op.table_start_index as number,
							op.row_index as number,
							0,
							tabId,
						),
						insertBelow,
					},
				},
			];
		}

		case "delete_table_row":
			return [
				{
					deleteTableRow: {
						tableCellLocation: buildTableCellLocation(
							op.table_start_index as number,
							op.row_index as number,
							0,
							tabId,
						),
					},
				},
			];

		case "insert_table_column": {
			const insertRight = op.insert_right !== false;
			return [
				{
					insertTableColumn: {
						tableCellLocation: buildTableCellLocation(
							op.table_start_index as number,
							0,
							op.column_index as number,
							tabId,
						),
						insertRight,
					},
				},
			];
		}

		case "delete_table_column":
			return [
				{
					deleteTableColumn: {
						tableCellLocation: buildTableCellLocation(
							op.table_start_index as number,
							0,
							op.column_index as number,
							tabId,
						),
					},
				},
			];

		case "merge_table_cells":
			return [
				{
					mergeTableCells: {
						tableRange: buildTableRange(
							op.table_start_index as number,
							op.row_index as number,
							op.column_index as number,
							op.row_span as number,
							op.column_span as number,
							tabId,
						),
					},
				},
			];

		case "unmerge_table_cells":
			return [
				{
					unmergeTableCells: {
						tableRange: buildTableRange(
							op.table_start_index as number,
							op.row_index as number,
							op.column_index as number,
							op.row_span as number,
							op.column_span as number,
							tabId,
						),
					},
				},
			];

		case "update_table_column_properties": {
			const colProps: Record<string, unknown> = {};
			const colFields: string[] = [];
			if (op.width !== undefined) {
				colProps.width = { magnitude: op.width, unit: "PT" };
				colFields.push("width");
			}
			if (op.width_type !== undefined) {
				colProps.widthType = op.width_type;
				colFields.push("widthType");
			}
			return [
				{
					updateTableColumnProperties: {
						tableStartLocation: buildLocation(
							op.table_start_index as number,
							tabId,
						),
						columnIndices: op.column_indices,
						tableColumnProperties: colProps,
						fields: colFields.join(",") || "*",
					},
				},
			];
		}

		case "insert_page_break": {
			if (op.end_of_segment) {
				return [
					{
						insertPageBreak: {
							endOfSegmentLocation: buildEndOfSegmentLocation(tabId, segmentId),
						},
					},
				];
			}
			const index = (op.index as number | undefined) ?? 1;
			return [
				{
					insertPageBreak: { location: buildLocation(index, tabId, segmentId) },
				},
			];
		}

		case "insert_section_break": {
			const sectionType =
				(op.section_type as string | undefined) ?? "NEXT_PAGE";
			if (op.end_of_segment) {
				return [
					{
						insertSectionBreak: {
							endOfSegmentLocation: buildEndOfSegmentLocation(tabId),
							sectionType,
						},
					},
				];
			}
			const index = (op.index as number | undefined) ?? 1;
			return [
				{
					insertSectionBreak: {
						location: buildLocation(index, tabId),
						sectionType,
					},
				},
			];
		}

		case "find_replace": {
			const req: Record<string, unknown> = {
				replaceAllText: {
					containsText: {
						text: op.find_text,
						matchCase: op.match_case === true,
					},
					replaceText: op.replace_text,
				},
			};
			if (tabId)
				(req.replaceAllText as Record<string, unknown>).tabsCriteria = {
					tabIds: [tabId],
				};
			return [req];
		}

		case "create_bullet_list": {
			const listType = (
				(op.list_type as string | undefined) ?? "UNORDERED"
			).toUpperCase();
			if (listType === "NONE") {
				return [
					{
						deleteParagraphBullets: {
							range: buildRange(
								op.start_index as number,
								op.end_index as number,
								tabId,
								segmentId,
							),
						},
					},
				];
			}
			const preset =
				(op.bullet_preset as string | undefined) ??
				BULLET_PRESET_MAP[listType] ??
				"BULLET_DISC_CIRCLE_SQUARE";
			return [
				{
					createParagraphBullets: {
						range: buildRange(
							op.start_index as number,
							op.end_index as number,
							tabId,
							segmentId,
						),
						bulletPreset: preset,
					},
				},
			];
		}

		case "create_named_range":
			return [
				{
					createNamedRange: {
						name: op.name,
						range: buildRange(
							op.start_index as number,
							op.end_index as number,
							tabId,
							segmentId,
						),
					},
				},
			];

		case "replace_named_range_content": {
			const req: Record<string, unknown> = { text: op.text };
			if (op.named_range_id) req.namedRangeId = op.named_range_id;
			if (op.named_range_name) req.namedRangeName = op.named_range_name;
			if (tabId) req.tabId = tabId;
			return [{ replaceNamedRangeContent: req }];
		}

		case "delete_named_range": {
			const req: Record<string, unknown> = {};
			if (op.named_range_id) req.namedRangeId = op.named_range_id;
			if (op.named_range_name) req.name = op.named_range_name;
			if (tabId) req.tabId = tabId;
			return [{ deleteNamedRange: req }];
		}

		case "update_document_style": {
			const docStyle: Record<string, unknown> = {};
			const docFields: string[] = [];
			if (op.background_color && typeof op.background_color === "string") {
				docStyle.background = {
					color: { rgbColor: hexToColor(op.background_color) },
				};
				docFields.push("background");
			}
			const dimFields = [
				"margin_top",
				"margin_bottom",
				"margin_left",
				"margin_right",
				"margin_header",
				"margin_footer",
				"page_width",
				"page_height",
			] as const;
			const dimMap: Record<string, string> = {
				margin_top: "marginTop",
				margin_bottom: "marginBottom",
				margin_left: "marginLeft",
				margin_right: "marginRight",
				margin_header: "marginHeader",
				margin_footer: "marginFooter",
				page_width: "pageSize.width",
				page_height: "pageSize.height",
			};
			for (const f of dimFields) {
				if (op[f] !== undefined) {
					const apiField = dimMap[f];
					// Handle nested pageSize
					if (f === "page_width" || f === "page_height") {
						if (!docStyle.pageSize) docStyle.pageSize = {};
						(docStyle.pageSize as Record<string, unknown>)[
							f === "page_width" ? "width" : "height"
						] = { magnitude: op[f], unit: "PT" };
					} else {
						docStyle[apiField] = { magnitude: op[f], unit: "PT" };
					}
					docFields.push(apiField);
				}
			}
			if (op.page_number_start !== undefined) {
				docStyle.pageNumberStart = op.page_number_start;
				docFields.push("pageNumberStart");
			}
			if (op.use_even_page_header_footer !== undefined) {
				docStyle.useEvenPageHeaderFooter = op.use_even_page_header_footer;
				docFields.push("useEvenPageHeaderFooter");
			}
			if (op.use_first_page_header_footer !== undefined) {
				docStyle.useFirstPageHeaderFooter = op.use_first_page_header_footer;
				docFields.push("useFirstPageHeaderFooter");
			}
			if (op.flip_page_orientation !== undefined) {
				docStyle.flipPageOrientation = op.flip_page_orientation;
				docFields.push("flipPageOrientation");
			}
			return [
				{
					updateDocumentStyle: {
						documentStyle: docStyle,
						fields: docFields.join(",") || "*",
					},
				},
			];
		}

		case "update_section_style": {
			const sectStyle: Record<string, unknown> = {};
			const sectFields: string[] = [];
			const sectDimMap: Record<string, string> = {
				margin_top: "marginTop",
				margin_bottom: "marginBottom",
				margin_left: "marginLeft",
				margin_right: "marginRight",
				margin_header: "marginHeader",
				margin_footer: "marginFooter",
			};
			for (const [k, v] of Object.entries(sectDimMap)) {
				if (op[k] !== undefined) {
					sectStyle[v] = { magnitude: op[k], unit: "PT" };
					sectFields.push(v);
				}
			}
			if (op.page_number_start !== undefined) {
				sectStyle.pageNumberStart = op.page_number_start;
				sectFields.push("pageNumberStart");
			}
			if (op.column_count !== undefined) {
				sectStyle.columnProperties = [];
				sectStyle.columnCount = op.column_count;
				sectFields.push("columnCount");
			}
			if (op.content_direction !== undefined) {
				sectStyle.contentDirection = op.content_direction;
				sectFields.push("contentDirection");
			}
			return [
				{
					updateSectionStyle: {
						range: buildRange(
							op.start_index as number,
							op.end_index as number,
							tabId,
						),
						sectionStyle: sectStyle,
						fields: sectFields.join(",") || "*",
					},
				},
			];
		}

		case "create_header_footer": {
			const sectionType = op.section_type as string;
			const hfType = (op.header_footer_type as string | undefined) ?? "DEFAULT";
			const createReq: Record<string, unknown> = { type: hfType };
			if (op.section_break_index !== undefined) {
				createReq.sectionBreakLocation = { index: op.section_break_index };
			}
			const requestKey =
				sectionType === "header" ? "createHeader" : "createFooter";
			return [{ [requestKey]: createReq }];
		}

		case "insert_image": {
			const uri = op.image_uri as string;
			const req: Record<string, unknown> = { uri };
			if (op.width || op.height) {
				req.objectSize = {
					...(op.height
						? { height: { magnitude: op.height, unit: "PT" } }
						: {}),
					...(op.width ? { width: { magnitude: op.width, unit: "PT" } } : {}),
				};
			}
			if (op.end_of_segment) {
				req.endOfSegmentLocation = buildEndOfSegmentLocation(tabId, segmentId);
			} else {
				req.location = buildLocation(
					(op.index as number | undefined) ?? 1,
					tabId,
					segmentId,
				);
			}
			return [{ insertInlineImage: req }];
		}

		case "insert_doc_tab": {
			const tabProperties: Record<string, unknown> = {
				title: op.title,
				index: op.index,
			};
			if (op.parent_tab_id) tabProperties.parentTabId = op.parent_tab_id;
			return [{ addDocumentTab: { tabProperties } }];
		}

		case "delete_doc_tab":
			return [{ deleteTab: { tabId: op.tab_id } }];

		case "update_doc_tab":
			return [
				{
					updateDocumentTabProperties: {
						tabProperties: { tabId: op.tab_id, title: op.title },
						fields: "title",
					},
				},
			];

		default:
			throw new Error(
				`Unknown operation type: "${type}". Supported types: insert_text, delete_text, replace_text, format_text, update_paragraph_style, update_table_cell_style, insert_table, insert_table_row, delete_table_row, insert_table_column, delete_table_column, merge_table_cells, unmerge_table_cells, update_table_column_properties, insert_page_break, insert_section_break, find_replace, create_bullet_list, create_named_range, replace_named_range_content, delete_named_range, update_document_style, update_section_style, create_header_footer, insert_image, insert_doc_tab, delete_doc_tab, update_doc_tab`,
			);
	}
}

// ─── Text extraction from native Docs ─────────────────────────────────────────

export function extractElementText(
	elements: DocBodyElement[],
	depth = 0,
): string {
	if (depth > 6) return "";
	let text = "";
	for (const elem of elements) {
		if (elem.paragraph) {
			for (const pe of elem.paragraph.elements ?? []) {
				if (pe.textRun?.content) text += pe.textRun.content;
			}
		} else if (elem.table) {
			for (const row of elem.table.tableRows ?? []) {
				for (const cell of row.tableCells ?? []) {
					text += extractElementText(cell.content ?? [], depth + 1);
				}
			}
		}
	}
	return text;
}

export function extractDocText(doc: DocumentResponse): string {
	const parts: string[] = [];

	// Main body
	const mainText = extractElementText(doc.body?.content ?? []);
	if (mainText.trim()) parts.push(mainText);

	// Tabs
	function processTab(tab: DocTab, level = 0): string {
		let tabText = "";
		if (tab.documentTab?.body) {
			const props = tab.tabProperties ?? {};
			const indent = "    ".repeat(level);
			const title = props.title ?? "Tab";
			const tabId = props.tabId ?? "";
			tabText += `\n--- TAB: ${indent}${title} (ID: ${tabId}) ---\n`;
			tabText += extractElementText(tab.documentTab.body.content ?? []);
		}
		for (const child of tab.childTabs ?? []) {
			tabText += processTab(child, level + 1);
		}
		return tabText;
	}

	for (const tab of doc.tabs ?? []) {
		const t = processTab(tab);
		if (t.trim()) parts.push(t);
	}

	return parts.join("");
}

// ─── Best-effort Docs → Markdown converter ────────────────────────────────────

const NAMED_STYLE_TO_HEADING: Record<string, string> = {
	TITLE: "# ",
	SUBTITLE: "## ",
	HEADING_1: "# ",
	HEADING_2: "## ",
	HEADING_3: "### ",
	HEADING_4: "#### ",
	HEADING_5: "##### ",
	HEADING_6: "###### ",
};

function elementsToMd(elements: DocParagraphElement[]): string {
	let line = "";
	for (const pe of elements) {
		const tr = pe.textRun;
		if (!tr?.content) continue;
		const content = tr.content.replace(/\n$/, "");
		if (!content) continue;
		const s = tr.textStyle ?? {};
		let chunk = content;
		if (s.bold && s.italic) chunk = `***${chunk}***`;
		else if (s.bold) chunk = `**${chunk}**`;
		else if (s.italic) chunk = `*${chunk}*`;
		else if (s.underline) chunk = `<u>${chunk}</u>`;
		if (s.link?.url) chunk = `[${chunk}](${s.link.url})`;
		line += chunk;
	}
	return line;
}

function bodyToMd(content: DocBodyElement[], nestLevel = 0): string {
	const lines: string[] = [];
	for (const elem of content) {
		if (elem.paragraph) {
			const para = elem.paragraph;
			const namedStyle = para.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT";
			const prefix = NAMED_STYLE_TO_HEADING[namedStyle] ?? "";
			const bullet = para.bullet;
			const text = elementsToMd(para.elements ?? []);
			if (!text.trim()) {
				lines.push("");
				continue;
			}
			if (bullet) {
				const indent = "  ".repeat((bullet.nestingLevel ?? 0) + nestLevel);
				lines.push(`${indent}- ${text}`);
			} else if (prefix) {
				lines.push(`${prefix}${text}`);
			} else {
				lines.push(text);
			}
		} else if (elem.table) {
			// Markdown table
			const tableRows = elem.table.tableRows ?? [];
			if (tableRows.length === 0) continue;
			const mdRows: string[][] = tableRows.map((row) =>
				(row.tableCells ?? []).map((cell) =>
					extractElementText(cell.content ?? [])
						.replace(/\n/g, " ")
						.trim(),
				),
			);
			const colCount = mdRows[0]?.length ?? 0;
			if (colCount === 0) continue;
			lines.push(`| ${mdRows[0].join(" | ")} |`);
			lines.push(`| ${Array(colCount).fill("---").join(" | ")} |`);
			for (let r = 1; r < mdRows.length; r++) {
				lines.push(`| ${(mdRows[r] ?? []).join(" | ")} |`);
			}
			lines.push("");
		} else if (elem.sectionBreak) {
			lines.push("\n---\n");
		}
	}
	return lines.join("\n");
}

export function docToMarkdown(doc: DocumentResponse): string {
	const parts: string[] = [];

	// Title
	if (doc.title) parts.push(`# ${doc.title}\n`);

	// Main body
	const bodyMd = bodyToMd(doc.body?.content ?? []);
	if (bodyMd.trim()) parts.push(bodyMd);

	// Tabs
	function processTabMd(tab: DocTab, level = 0): string {
		let md = "";
		if (tab.documentTab?.body) {
			const title = tab.tabProperties?.title ?? "Tab";
			const tabId = tab.tabProperties?.tabId ?? "";
			md += `\n${"#".repeat(Math.min(level + 2, 6))} Tab: ${title} (${tabId})\n`;
			md += bodyToMd(tab.documentTab.body.content ?? [], level);
		}
		for (const child of tab.childTabs ?? []) {
			md += processTabMd(child, level + 1);
		}
		return md;
	}

	for (const tab of doc.tabs ?? []) {
		const t = processTabMd(tab);
		if (t.trim()) parts.push(t);
	}

	return parts.join("\n");
}

// ─── Document structure analysis ──────────────────────────────────────────────

export interface TableInfo {
	startIndex: number;
	endIndex: number;
	rows: number;
	columns: number;
	cells: Array<
		Array<{
			startIndex: number;
			endIndex: number;
			insertionIndex: number;
			content: string;
		}>
	>;
}

export function findTablesInContent(content: DocBodyElement[]): TableInfo[] {
	const tables: TableInfo[] = [];
	for (const elem of content) {
		if (!elem.table) continue;
		const startIndex = elem.startIndex ?? 0;
		const endIndex = elem.endIndex ?? startIndex;
		const rows = elem.table.rows ?? 0;
		const cols = elem.table.columns ?? 0;
		const cells: TableInfo["cells"] = [];
		for (const row of elem.table.tableRows ?? []) {
			const rowCells: TableInfo["cells"][0] = [];
			for (const cell of row.tableCells ?? []) {
				const cStart = cell.startIndex ?? 0;
				const cEnd = cell.endIndex ?? cStart;
				// Insertion index = start of first paragraph's first text element
				let insertionIndex = cStart + 2; // default fallback
				const firstContent = cell.content?.[0];
				if (firstContent?.paragraph?.elements?.[0]?.startIndex !== undefined) {
					insertionIndex = firstContent.paragraph.elements[0].startIndex;
				} else if (firstContent?.startIndex !== undefined) {
					insertionIndex = firstContent.startIndex + 1;
				}
				// Current content
				let contentText = "";
				for (const c of cell.content ?? []) {
					contentText += extractElementText([c]);
				}
				rowCells.push({
					startIndex: cStart,
					endIndex: cEnd,
					insertionIndex,
					content: contentText.replace(/\n/g, "\\n"),
				});
			}
			cells.push(rowCells);
		}
		tables.push({ startIndex, endIndex, rows, columns: cols, cells });
	}
	return tables;
}

export interface DocStructure {
	title: string;
	totalLength: number;
	elements: Array<{
		type: string;
		startIndex: number;
		endIndex: number;
		textPreview?: string;
		rows?: number;
		columns?: number;
		cellCount?: number;
	}>;
	tables: TableInfo[];
	sectionBreaks: Array<{ startIndex: number; endIndex: number }>;
	tabs: Array<{ title?: string; tabId?: string; childTabs?: unknown[] }>;
}

export function analyzeDoc(
	doc: DocumentResponse,
	tabId?: string,
): DocStructure {
	let content: DocBodyElement[] = doc.body?.content ?? [];

	if (tabId) {
		function findTab(tabs: DocTab[], targetId: string): DocTab | null {
			for (const tab of tabs) {
				if (tab.tabProperties?.tabId === targetId) return tab;
				const found = findTab(tab.childTabs ?? [], targetId);
				if (found) return found;
			}
			return null;
		}
		const tab = findTab(doc.tabs ?? [], tabId);
		if (tab?.documentTab?.body) {
			content = tab.documentTab.body.content ?? [];
		}
	}

	const elements: DocStructure["elements"] = [];
	const sectionBreaks: DocStructure["sectionBreaks"] = [];
	let totalLength = 1;

	for (const elem of content) {
		const si = elem.startIndex ?? 0;
		const ei = elem.endIndex ?? si;
		if (ei > totalLength) totalLength = ei;

		if (elem.paragraph) {
			const text = elementsToMd(elem.paragraph.elements ?? []).slice(0, 100);
			elements.push({
				type: "paragraph",
				startIndex: si,
				endIndex: ei,
				textPreview: text,
			});
		} else if (elem.table) {
			const rows = elem.table.rows ?? 0;
			const cols = elem.table.columns ?? 0;
			let cellCount = 0;
			for (const row of elem.table.tableRows ?? [])
				cellCount += row.tableCells?.length ?? 0;
			elements.push({
				type: "table",
				startIndex: si,
				endIndex: ei,
				rows,
				columns: cols,
				cellCount,
			});
		} else if (elem.sectionBreak) {
			elements.push({ type: "sectionBreak", startIndex: si, endIndex: ei });
			sectionBreaks.push({ startIndex: si, endIndex: ei });
		}
	}

	const tables = findTablesInContent(content);

	function getTabsSummary(
		tabs: DocTab[],
	): Array<{ title?: string; tabId?: string; childTabs?: unknown[] }> {
		return tabs.map((tab) => ({
			title: tab.tabProperties?.title,
			tabId: tab.tabProperties?.tabId,
			...(tab.childTabs?.length
				? { childTabs: getTabsSummary(tab.childTabs) }
				: {}),
		}));
	}

	return {
		title: doc.title ?? "",
		totalLength,
		elements,
		tables,
		sectionBreaks,
		tabs: getTabsSummary(doc.tabs ?? []),
	};
}
