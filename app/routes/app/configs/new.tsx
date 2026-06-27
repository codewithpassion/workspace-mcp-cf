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
import { api, type GoogleService, SERVICE_LABELS } from "@/lib/api";

export const Route = createFileRoute("/app/configs/new")({
	component: NewConfigPage,
});

const ALL_SERVICES = Object.entries(SERVICE_LABELS) as [
	GoogleService,
	string,
][];

function NewConfigPage() {
	const router = useRouter();
	const [submitting, setSubmitting] = useState(false);
	const [slug, setSlug] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [enabledServices, setEnabledServices] = useState<Set<GoogleService>>(
		new Set(),
	);

	function toggleService(id: GoogleService) {
		setEnabledServices((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (enabledServices.size === 0) {
			toast.error("Select at least one service");
			return;
		}
		setSubmitting(true);
		try {
			await api.create({
				slug,
				displayName,
				enabledServices: Array.from(enabledServices),
			});
			toast.success(`Created "${slug}"`);
			router.navigate({ to: "/app/configs/$slug", params: { slug } });
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
							value={slug}
							onChange={(e) => setSlug(e.target.value)}
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
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label>Services</Label>
						<p className="text-xs text-muted-foreground">
							Select at least one Google service to enable.
						</p>
						<div className="grid grid-cols-2 gap-2 pt-1">
							{ALL_SERVICES.map(([id, label]) => (
								<label
									key={id}
									className="flex cursor-pointer items-center gap-2 text-sm"
								>
									<input
										type="checkbox"
										className="h-4 w-4 accent-primary"
										checked={enabledServices.has(id)}
										onChange={() => toggleService(id)}
									/>
									{label}
								</label>
							))}
						</div>
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
