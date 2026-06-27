import { UserButton } from "@clerk/tanstack-react-start";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { requireAuthFn } from "@/lib/auth";

export const Route = createFileRoute("/app")({
	beforeLoad: async () => await requireAuthFn(),
	component: AppLayout,
});

function AppLayout() {
	return (
		<div className="min-h-screen bg-background">
			<header className="border-b">
				<div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
					<Link to="/app/configs" className="font-semibold">
						Plane MCP Gateway
					</Link>
					<UserButton />
				</div>
			</header>
			<main className="mx-auto max-w-5xl px-6 py-8">
				<Outlet />
			</main>
		</div>
	);
}
