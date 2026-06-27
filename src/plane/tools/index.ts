import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PlaneAppContext } from "../client";
import { registerCycleTools } from "./cycles";
import { registerEpicTools } from "./epics";
import { registerInitiativeTools } from "./initiatives";
import { registerIntakeTools } from "./intake";
import { registerLabelTools } from "./labels";
import { registerMilestoneTools } from "./milestones";
import { registerModuleTools } from "./modules";
import { registerPageTools } from "./pages";
import { registerProjectTools } from "./projects";
import { registerStateTools } from "./states";
import { registerUserTools } from "./users";
import { registerWorkItemActivityTools } from "./work_item_activities";
import { registerWorkItemCommentTools } from "./work_item_comments";
import { registerWorkItemLinkTools } from "./work_item_links";
import { registerWorkItemPropertyTools } from "./work_item_properties";
import { registerWorkItemRelationTools } from "./work_item_relations";
import { registerWorkItemTypeTools } from "./work_item_types";
import { registerWorkItemTools } from "./work_items";
import { registerWorkLogTools } from "./work_logs";
import { registerWorkspaceTools } from "./workspaces";

export function registerPlaneTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	registerProjectTools(server, ctx);
	registerWorkItemTools(server, ctx);
	registerWorkItemActivityTools(server, ctx);
	registerWorkItemCommentTools(server, ctx);
	registerWorkItemLinkTools(server, ctx);
	registerWorkItemRelationTools(server, ctx);
	registerWorkLogTools(server, ctx);
	registerCycleTools(server, ctx);
	registerUserTools(server, ctx);
	registerModuleTools(server, ctx);
	registerInitiativeTools(server, ctx);
	registerIntakeTools(server, ctx);
	registerLabelTools(server, ctx);
	registerPageTools(server, ctx);
	registerWorkItemPropertyTools(server, ctx);
	registerWorkItemTypeTools(server, ctx);
	registerStateTools(server, ctx);
	registerWorkspaceTools(server, ctx);
	registerEpicTools(server, ctx);
	registerMilestoneTools(server, ctx);
}
