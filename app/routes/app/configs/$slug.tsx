import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ConfigRecord } from "@/lib/api";

export const Route = createFileRoute("/app/configs/$slug")({
	component: EditConfigPage,
});

// TODO (P0f): add enabledServices checkboxes and Connect Google Account button.

function EditConfigPage() {
	const { slug } = Route.useParams();
	const router = useRouter();
	const [record, setRecord] = useState<ConfigRecord | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [form, setForm] = useState({
		displayName: "",
	});
	const [saving, setSaving] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);

	useEffect(() => {
		api
			.get(slug)
			.then((r) => {
				setRecord(r);
				setForm({ displayName: r.displayName });
			})
			.catch((e: Error) => setLoadError(e.message));
	}, [slug]);

	function update<K extends keyof typeof form>(
		key: K,
		value: (typeof form)[K],
	) {
		setForm((f) => ({ ...f, [key]: value }));
	}

	async function onSave(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		try {
			const updated = await api.update(slug, {
				displayName: form.displayName,
			});
			setRecord(updated);
			toast.success("Saved");
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setSaving(false);
		}
	}

	async function onDelete() {
		setDeleting(true);
		try {
			await api.remove(slug);
			toast.success(`Deleted ${slug}`);
			router.navigate({ to: "/app/configs" });
		} catch (e) {
			toast.error((e as Error).message);
			setDeleting(false);
		}
	}

	if (loadError) {
		return (
			<div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
				{loadError}
			</div>
		);
	}

	if (!record) {
		return <div className="text-muted-foreground">Loading...</div>;
	}

	return (
		<>
			<Card className="mx-auto max-w-xl">
				<CardHeader>
					<CardTitle className="font-mono">{record.slug}</CardTitle>
					<CardDescription>
						{record.googleAccountEmail
							? `Connected: ${record.googleAccountEmail}`
							: "No Google account connected"}
					</CardDescription>
				</CardHeader>
				<form onSubmit={onSave}>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="displayName">Display name</Label>
							<Input
								id="displayName"
								required
								value={form.displayName}
								onChange={(e) => update("displayName", e.target.value)}
							/>
						</div>
					</CardContent>
					<CardFooter className="justify-between gap-2">
						<Button
							type="button"
							variant="destructive"
							onClick={() => setConfirmDelete(true)}
						>
							Delete
						</Button>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => router.navigate({ to: "/app/configs" })}
							>
								Back
							</Button>
							<Button type="submit" disabled={saving}>
								{saving ? "Saving..." : "Save"}
							</Button>
						</div>
					</CardFooter>
				</form>
			</Card>

			<Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete configuration?</DialogTitle>
						<DialogDescription>
							This permanently deletes <span className="font-mono">{slug}</span>
							. MCP clients connecting to <code>/mcp/{slug}</code> in new
							sessions will get 404. Existing in-memory sessions continue until
							the worker restarts.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setConfirmDelete(false)}
							disabled={deleting}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={onDelete}
							disabled={deleting}
						>
							{deleting ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
