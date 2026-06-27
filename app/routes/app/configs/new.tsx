import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ProjectOption } from "@/lib/api";

export const Route = createFileRoute("/app/configs/new")({
	component: NewConfigPage,
});

const ALL_PROJECTS = "__all__";

function NewConfigPage() {
	const router = useRouter();
	const [submitting, setSubmitting] = useState(false);
	const [form, setForm] = useState({
		slug: "",
		displayName: "",
		planeWorkspaceSlug: "",
		apiKey: "",
		baseUrl: "",
		projectId: ALL_PROJECTS,
	});
	const [projects, setProjects] = useState<ProjectOption[] | null>(null);
	const [loadingProjects, setLoadingProjects] = useState(false);

	function update<K extends keyof typeof form>(
		key: K,
		value: (typeof form)[K],
	) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	const canLoadProjects = Boolean(form.apiKey && form.planeWorkspaceSlug);

	async function onLoadProjects() {
		setLoadingProjects(true);
		try {
			const list = await api.probeProjects({
				planeWorkspaceSlug: form.planeWorkspaceSlug,
				apiKey: form.apiKey,
				baseUrl: form.baseUrl || undefined,
			});
			setProjects(list);
			toast.success(
				`Loaded ${list.length} project${list.length === 1 ? "" : "s"}`,
			);
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setLoadingProjects(false);
		}
	}

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		try {
			const pinned =
				form.projectId !== ALL_PROJECTS
					? projects?.find((p) => p.id === form.projectId)
					: null;
			await api.create({
				slug: form.slug,
				displayName: form.displayName,
				planeWorkspaceSlug: form.planeWorkspaceSlug,
				apiKey: form.apiKey,
				baseUrl: form.baseUrl || undefined,
				...(pinned
					? {
							projectId: pinned.id,
							projectName: pinned.name,
							projectIdentifier: pinned.identifier,
						}
					: {}),
			});
			toast.success(`Created config "${form.slug}"`);
			router.navigate({ to: "/app/configs" });
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Card className="mx-auto max-w-xl">
			<CardHeader>
				<CardTitle>New Plane configuration</CardTitle>
				<CardDescription>
					MCP clients connect to <code>/mcp/&lt;slug&gt;</code> to use this
					configuration.
				</CardDescription>
			</CardHeader>
			<form onSubmit={onSubmit}>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="slug">Slug</Label>
						<Input
							id="slug"
							required
							pattern="^[a-z0-9][a-z0-9-]{1,62}$"
							placeholder="work"
							value={form.slug}
							onChange={(e) => update("slug", e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							lowercase letters, digits, hyphens; 2-63 chars
						</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="displayName">Display name</Label>
						<Input
							id="displayName"
							required
							placeholder="Work workspace"
							value={form.displayName}
							onChange={(e) => update("displayName", e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="planeWorkspaceSlug">Plane workspace slug</Label>
						<Input
							id="planeWorkspaceSlug"
							required
							placeholder="my-workspace"
							value={form.planeWorkspaceSlug}
							onChange={(e) => update("planeWorkspaceSlug", e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="apiKey">Plane API key</Label>
						<Input
							id="apiKey"
							type="password"
							required
							value={form.apiKey}
							onChange={(e) => update("apiKey", e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="baseUrl">Base URL (optional)</Label>
						<Input
							id="baseUrl"
							type="url"
							placeholder="https://api.plane.so"
							value={form.baseUrl}
							onChange={(e) => update("baseUrl", e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label htmlFor="projectId">Pinned project (optional)</Label>
							<button
								type="button"
								className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
								onClick={onLoadProjects}
								disabled={!canLoadProjects || loadingProjects}
							>
								{loadingProjects
									? "Loading..."
									: projects
										? "Reload projects"
										: "Load projects"}
							</button>
						</div>
						<select
							id="projectId"
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
							value={form.projectId}
							onChange={(e) => update("projectId", e.target.value)}
							disabled={!projects}
						>
							<option value={ALL_PROJECTS}>
								All projects (workspace-wide)
							</option>
							{projects?.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name} ({p.identifier})
								</option>
							))}
						</select>
						<p className="text-xs text-muted-foreground">
							{projects
								? "Pinning auto-scopes MCP tools to one project and removes the project_id parameter."
								: "Enter API key and workspace slug, then load projects to optionally pin one."}
						</p>
					</div>
				</CardContent>
				<CardFooter className="justify-end gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => router.navigate({ to: "/app/configs" })}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={submitting}>
						{submitting ? "Creating..." : "Create"}
					</Button>
				</CardFooter>
			</form>
		</Card>
	);
}
