import { auth } from "@clerk/tanstack-react-start/server";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

export const requireAuthFn = createServerFn().handler(async () => {
	const { isAuthenticated, userId } = await auth();
	if (!isAuthenticated) {
		throw redirect({ to: "/sign-in" });
	}
	return { userId: userId as string };
});

export const getAuthStateFn = createServerFn().handler(async () => {
	const { isAuthenticated, userId } = await auth();
	return { isAuthenticated, userId };
});
