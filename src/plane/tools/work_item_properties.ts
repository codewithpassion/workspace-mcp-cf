import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PlaneAppContext } from "../client";
import { workItemProperties } from "../resources/work_item_properties";
import type { PropertyTypeEnum, RelationTypeEnum } from "../types/common";
import type {
	CreateWorkItemPropertyOptionBody,
	PropertySettings,
} from "../types/work_item_properties";
import { projectIdField, requireProjectId, toolResult } from "./_helpers";

const PROPERTY_TYPES: readonly PropertyTypeEnum[] = [
	"TEXT",
	"DATETIME",
	"DECIMAL",
	"BOOLEAN",
	"OPTION",
	"RELATION",
	"URL",
	"EMAIL",
	"FILE",
];

const RELATION_TYPES: readonly RelationTypeEnum[] = ["ISSUE", "USER"];

function asPropertyType(value: string): PropertyTypeEnum {
	if (!(PROPERTY_TYPES as readonly string[]).includes(value)) {
		throw new Error(
			`Invalid property_type '${value}'. Must be one of: ${PROPERTY_TYPES.join(", ")}`,
		);
	}
	return value as PropertyTypeEnum;
}

function asRelationType(
	value: string | undefined,
): RelationTypeEnum | undefined {
	if (!value) return undefined;
	if (!(RELATION_TYPES as readonly string[]).includes(value)) {
		throw new Error(
			`Invalid relation_type '${value}'. Must be one of: ${RELATION_TYPES.join(", ")}`,
		);
	}
	return value as RelationTypeEnum;
}

function processSettings(
	propertyType: string | undefined,
	settings: Record<string, unknown> | undefined,
): PropertySettings | undefined {
	if (!settings) return undefined;
	if (propertyType === "TEXT" || propertyType === "DATETIME") {
		return settings as PropertySettings;
	}
	return undefined;
}

function processOptions(
	options: Record<string, unknown>[] | undefined,
): CreateWorkItemPropertyOptionBody[] | undefined {
	if (!options) return undefined;
	return options.map(
		(opt) => opt as unknown as CreateWorkItemPropertyOptionBody,
	);
}

export function registerWorkItemPropertyTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool(
		"list_work_item_properties",
		"List work item properties for a work item type.",
		{
			...projectIdField(ctx),
			type_id: z.string().describe("UUID of the work item type"),
			params: z
				.record(z.unknown())
				.optional()
				.describe("Optional query parameters as a dictionary"),
		},
		async (input) =>
			toolResult(() =>
				workItemProperties.list(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.type_id,
					input.params ?? null,
				),
			),
	);

	server.tool(
		"create_work_item_property",
		"Create a new work item property.",
		{
			...projectIdField(ctx),
			type_id: z.string().describe("UUID of the work item type"),
			display_name: z.string().describe("Display name for the property"),
			property_type: z
				.string()
				.describe(
					"Type of property (TEXT, DATETIME, DECIMAL, BOOLEAN, OPTION, RELATION, URL, EMAIL, FILE)",
				),
			relation_type: z
				.string()
				.optional()
				.describe(
					"Relation type (ISSUE, USER) - required for RELATION properties",
				),
			description: z.string().optional().describe("Property description"),
			is_required: z
				.boolean()
				.optional()
				.describe("Whether the property is required"),
			default_value: z
				.array(z.string())
				.optional()
				.describe("Default value(s) for the property"),
			settings: z
				.record(z.unknown())
				.optional()
				.describe(
					'Settings dictionary - required for TEXT and DATETIME properties. For TEXT: {"display_format": "single-line"|"multi-line"|"readonly"}. For DATETIME: {"display_format": "MMM dd, yyyy"|"dd/MM/yyyy"|"MM/dd/yyyy"|"yyyy/MM/dd"}',
				),
			is_active: z
				.boolean()
				.optional()
				.describe("Whether the property is active"),
			is_multi: z
				.boolean()
				.optional()
				.describe("Whether the property supports multiple values"),
			validation_rules: z
				.record(z.unknown())
				.optional()
				.describe("Validation rules dictionary"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
			options: z
				.array(z.record(z.unknown()))
				.optional()
				.describe("List of option dictionaries for OPTION properties"),
		},
		async (input) =>
			toolResult(() =>
				workItemProperties.create(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.type_id,
					{
						display_name: input.display_name,
						property_type: asPropertyType(input.property_type),
						relation_type: asRelationType(input.relation_type),
						description: input.description,
						is_required: input.is_required,
						default_value: input.default_value,
						settings: processSettings(input.property_type, input.settings),
						is_active: input.is_active,
						is_multi: input.is_multi,
						validation_rules: input.validation_rules,
						external_source: input.external_source,
						external_id: input.external_id,
						options: processOptions(input.options),
					},
				),
			),
	);

	server.tool(
		"retrieve_work_item_property",
		"Retrieve a work item property by ID.",
		{
			...projectIdField(ctx),
			type_id: z.string().describe("UUID of the work item type"),
			work_item_property_id: z.string().describe("UUID of the property"),
		},
		async (input) =>
			toolResult(() =>
				workItemProperties.retrieve(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.type_id,
					input.work_item_property_id,
				),
			),
	);

	server.tool(
		"update_work_item_property",
		"Update a work item property by ID.",
		{
			...projectIdField(ctx),
			type_id: z.string().describe("UUID of the work item type"),
			work_item_property_id: z.string().describe("UUID of the property"),
			display_name: z
				.string()
				.optional()
				.describe("Display name for the property"),
			property_type: z
				.string()
				.optional()
				.describe(
					"Type of property (TEXT, DATETIME, DECIMAL, BOOLEAN, OPTION, RELATION, URL, EMAIL, FILE)",
				),
			relation_type: z
				.string()
				.optional()
				.describe(
					"Relation type (ISSUE, USER) - required when updating to RELATION",
				),
			description: z.string().optional().describe("Property description"),
			is_required: z
				.boolean()
				.optional()
				.describe("Whether the property is required"),
			default_value: z
				.array(z.string())
				.optional()
				.describe("Default value(s) for the property"),
			settings: z
				.record(z.unknown())
				.optional()
				.describe(
					'Settings dictionary - required when updating to TEXT or DATETIME. For TEXT: {"display_format": "single-line"|"multi-line"|"readonly"}. For DATETIME: {"display_format": "MMM dd, yyyy"|"dd/MM/yyyy"|"MM/dd/yyyy"|"yyyy/MM/dd"}',
				),
			is_active: z
				.boolean()
				.optional()
				.describe("Whether the property is active"),
			is_multi: z
				.boolean()
				.optional()
				.describe("Whether the property supports multiple values"),
			validation_rules: z
				.record(z.unknown())
				.optional()
				.describe("Validation rules dictionary"),
			external_source: z
				.string()
				.optional()
				.describe("External system source name"),
			external_id: z.string().optional().describe("External system identifier"),
		},
		async (input) =>
			toolResult(() =>
				workItemProperties.update(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.type_id,
					input.work_item_property_id,
					{
						display_name: input.display_name,
						property_type: input.property_type
							? asPropertyType(input.property_type)
							: undefined,
						relation_type: asRelationType(input.relation_type),
						description: input.description,
						is_required: input.is_required,
						default_value: input.default_value,
						settings:
							input.property_type !== undefined
								? processSettings(input.property_type, input.settings)
								: undefined,
						is_active: input.is_active,
						is_multi: input.is_multi,
						validation_rules: input.validation_rules,
						external_source: input.external_source,
						external_id: input.external_id,
					},
				),
			),
	);

	server.tool(
		"delete_work_item_property",
		"Delete a work item property by ID.",
		{
			...projectIdField(ctx),
			type_id: z.string().describe("UUID of the work item type"),
			work_item_property_id: z.string().describe("UUID of the property"),
		},
		async (input) =>
			toolResult(() =>
				workItemProperties.delete(
					ctx.config,
					ctx.workspaceSlug,
					requireProjectId(ctx, input),
					input.type_id,
					input.work_item_property_id,
				),
			),
	);
}
