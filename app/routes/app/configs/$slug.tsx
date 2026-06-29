import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ServiceSelector } from "@/components/service-selector";
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
import { api, type ConfigRecord, type GoogleService } from "@/lib/api";
import { SEARCH_UNCONFIGURED_REASON } from "@/lib/service-availability";

export const Route = createFileRoute("/app/configs/$slug")({
	component: EditConfigPage,
});

function EditConfigPage() {
	const { slug } = Route.useParams();
	const router = useRouter();
	const [record, setRecord] = useState<ConfigRecord | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [displayName, setDisplayName] = useState("");
	const [enabledServices, setEnabledServices] = useState<Set<GoogleService>>(
		new Set(),
	);
	const [saving, setSaving] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [disconnecting, setDisconnecting] = useState(false);
	const [mcpUrl, setMcpUrl] = useState("");
	const [searchConfigured, setSearchConfigured] = useState(true);

	useEffect(() => {
		setMcpUrl(`${window.location.origin}/mcp/${slug}`);
	}, [slug]);

	useEffect(() => {
		api
			.capabilities()
			.then((c) => setSearchConfigured(c.searchConfigured))
			.catch(() => {});
	}, []);

	const disabledServices = searchConfigured
		? undefined
		: { gsearch: SEARCH_UNCONFIGURED_REASON };

	useEffect(() => {
		api
			.get(slug)
			.then((r) => {
				setRecord(r);
				setDisplayName(r.displayName);
				setEnabledServices(new Set(r.enabledServices));
			})
			.catch((e: Error) => setLoadError(e.message));
	}, [slug]);

	function toggleService(id: GoogleService) {
		setEnabledServices((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	async function onSave(e: React.FormEvent) {
		e.preventDefault();
		if (enabledServices.size === 0) {
			toast.error("Select at least one service");
			return;
		}
		setSaving(true);
		try {
			const updated = await api.update(slug, {
				displayName,
				enabledServices: Array.from(enabledServices),
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

	async function onDisconnect() {
		setDisconnecting(true);
		try {
			await api.googleAuthDisconnect(slug);
			setRecord((prev) =>
				prev
					? {
							...prev,
							googleAccountEmail: undefined,
							googleAccountSub: undefined,
						}
					: prev,
			);
			toast.success("Google account disconnected");
		} catch (e) {
			toast.error((e as Error).message);
		} finally {
			setDisconnecting(false);
		}
	}

	function onConnect() {
		window.location.href = api.googleAuthStartUrl(slug);
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
			<div className="mx-auto max-w-xl space-y-4">
				{/* MCP endpoint */}
				<div className="rounded-md border p-3">
					<p className="mb-1 text-xs font-medium text-muted-foreground">
						MCP endpoint
					</p>
					<div className="flex items-center gap-2">
						<code className="flex-1 truncate font-mono text-xs">{mcpUrl}</code>
						<Button
							variant="ghost"
							size="sm"
							onClick={async () => {
								try {
									await navigator.clipboard.writeText(mcpUrl);
									toast.success("MCP URL copied");
								} catch {
									toast.error("Copy failed");
								}
							}}
						>
							Copy
						</Button>
					</div>
				</div>

				{/* Config form */}
				<Card>
					<CardHeader>
						<CardTitle className="font-mono">{record.slug}</CardTitle>
						<CardDescription>Edit configuration settings</CardDescription>
					</CardHeader>
					<form onSubmit={onSave}>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="displayName">Display name</Label>
								<Input
									id="displayName"
									required
									value={displayName}
									onChange={(e) => setDisplayName(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Services</Label>
								<ServiceSelector
									value={enabledServices}
									onToggle={toggleService}
									disabledServices={disabledServices}
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

				{/* Google account */}
				<Card>
					<CardHeader>
						<CardTitle>Google account</CardTitle>
						<CardDescription>
							Link a Google account to authenticate MCP tool requests.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{record.googleAccountEmail ? (
							<div className="flex items-center justify-between">
								<div>
									<p className="text-sm font-medium">
										{record.googleAccountEmail}
									</p>
									<p className="text-xs text-muted-foreground">Connected</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={onDisconnect}
									disabled={disconnecting}
								>
									{disconnecting ? "Disconnecting..." : "Disconnect"}
								</Button>
							</div>
						) : (
							<div className="flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									No Google account connected
								</p>
								<Button variant="outline" size="sm" onClick={onConnect}>
									Connect Google account
								</Button>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

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
