import { type PlaneConfig, planeFetch } from "../client";
import type { UserLite } from "../types/users";

export const users = {
	getMe(config: PlaneConfig): Promise<UserLite> {
		return planeFetch<UserLite>(config, "GET", "users/me");
	},
};
