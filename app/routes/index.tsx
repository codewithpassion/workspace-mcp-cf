import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuthStateFn } from "@/lib/auth";

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const { isAuthenticated } = await getAuthStateFn();
		throw redirect({ to: isAuthenticated ? "/app/configs" : "/sign-in" });
	},
});
