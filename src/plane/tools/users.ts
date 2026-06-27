import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PlaneAppContext } from "../client";
import { users } from "../resources/users";
import { toolResult } from "./_helpers";

export function registerUserTools(
	server: McpServer,
	ctx: PlaneAppContext,
): void {
	server.tool("get_me", "Get current user information.", {}, async () =>
		toolResult(() => users.getMe(ctx.config)),
	);
}
