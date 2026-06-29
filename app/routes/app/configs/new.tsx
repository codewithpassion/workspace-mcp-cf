import { createFileRoute, useRouter } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type GoogleService } from "@/lib/api";
import { SEARCH_UNCONFIGURED_REASON } from "@/lib/service-availability";
import { generateSlug } from "@/lib/slug";

export const Route = createFileRoute("/app/configs/new")({
	component: NewConfigPage,
});

function NewConfigPage() {
	const router = useRouter();
	const [submitting, setSubmitting] = useState(false);
	const [slug, setSlug] = useState(generateSlug);
	const [displayName, setDisplayName] = useState("");
	const [searchConfigured, setSearchConfigured] = useState(true);
	const [enabledServices, setEnabledServices] = useState<Set<GoogleService>>(
		new Set(),
	);

	useEffect(() => {
		api
			.capabilities()
			.then((c) => setSearchConfigured(c.searchConfigured))
			.catch(() => {});
	}, []);

	const disabledServices = searchConfigured
		? undefined
		: { gsearch: SEARCH_UNCONFIGURED_REASON };

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
						<div className="flex gap-2">
							<Input id="slug" readOnly value={slug} className="font-mono" />
							<Button
								type="button"
								variant="outline"
								size="icon"
								aria-label="Regenerate slug"
								onClick={() => setSlug(generateSlug())}
							>
								<RefreshCw className="h-4 w-4" />
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							auto-generated &mdash; use the button to get a new one
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
						<ServiceSelector
							value={enabledServices}
							onToggle={toggleService}
							disabledServices={disabledServices}
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
