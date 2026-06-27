import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api, type ConfigRecord } from "@/lib/api";

export const Route = createFileRoute("/app/configs/")({
	component: ConfigsList,
});

function ConfigsList() {
	const router = useRouter();
	const [configs, setConfigs] = useState<ConfigRecord[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api
			.list()
			.then(setConfigs)
			.catch((e: Error) => setError(e.message));
	}, []);

	async function onDelete(slug: string) {
		if (!confirm(`Delete config "${slug}"? This cannot be undone.`)) return;
		try {
			await api.remove(slug);
			toast.success(`Deleted ${slug}`);
			setConfigs((prev) => prev?.filter((c) => c.slug !== slug) ?? null);
		} catch (e) {
			toast.error((e as Error).message);
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">MCP configurations</h1>
				<Button onClick={() => router.navigate({ to: "/app/configs/new" })}>
					New config
				</Button>
			</div>

			{error && (
				<div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
					{error}
				</div>
			)}

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Slug</TableHead>
							<TableHead>Display name</TableHead>
							<TableHead>MCP URL</TableHead>
							<TableHead>API key</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{configs === null && !error && (
							<TableRow>
								<TableCell
									colSpan={5}
									className="text-center text-muted-foreground"
								>
									Loading...
								</TableCell>
							</TableRow>
						)}
						{configs?.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={5}
									className="text-center text-muted-foreground"
								>
									No configurations yet. Create one to get started.
								</TableCell>
							</TableRow>
						)}
						{configs?.map((c) => (
							<TableRow key={c.slug}>
								<TableCell>
									<Link
										to="/app/configs/$slug"
										params={{ slug: c.slug }}
										className="font-mono text-sm underline-offset-4 hover:underline"
									>
										{c.slug}
									</Link>
								</TableCell>
								<TableCell>{c.displayName}</TableCell>
								<TableCell>
									<McpUrlCell slug={c.slug} />
								</TableCell>
								<TableCell>
									<Badge variant="secondary" className="font-mono">
										{c.apiKey}
									</Badge>
								</TableCell>
								<TableCell className="space-x-2 text-right">
									<Button
										variant="outline"
										size="sm"
										onClick={() =>
											router.navigate({
												to: "/app/configs/$slug",
												params: { slug: c.slug },
											})
										}
									>
										Edit
									</Button>
									<Button
										variant="destructive"
										size="sm"
										onClick={() => onDelete(c.slug)}
									>
										Delete
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function McpUrlCell({ slug }: { slug: string }) {
	const [origin, setOrigin] = useState("");
	useEffect(() => {
		setOrigin(window.location.origin);
	}, []);
	const url = origin ? `${origin}/mcp/${slug}` : `/mcp/${slug}`;
	async function copy() {
		try {
			await navigator.clipboard.writeText(url);
			toast.success("MCP URL copied");
		} catch {
			toast.error("Copy failed");
		}
	}
	return (
		<div className="flex items-center gap-2">
			<code className="truncate font-mono text-xs text-muted-foreground">
				{url}
			</code>
			<Button variant="ghost" size="sm" onClick={copy}>
				Copy
			</Button>
		</div>
	);
}
