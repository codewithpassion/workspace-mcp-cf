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
import { api } from "@/lib/api";

export const Route = createFileRoute("/app/configs/new")({
	component: NewConfigPage,
});

// TODO (P0f): add enabledServices multi-select checkboxes.
// For now, defaults to all services disabled until the user edits.

function NewConfigPage() {
	const router = useRouter();
	const [submitting, setSubmitting] = useState(false);
	const [form, setForm] = useState({
		slug: "",
		displayName: "",
	});

	function update<K extends keyof typeof form>(
		key: K,
		value: (typeof form)[K],
	) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSubmitting(true);
		try {
			await api.create({
				slug: form.slug,
				displayName: form.displayName,
				enabledServices: [],
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
				<CardTitle>New MCP configuration</CardTitle>
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
							placeholder="my-workspace"
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
							placeholder="My workspace"
							value={form.displayName}
							onChange={(e) => update("displayName", e.target.value)}
						/>
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
