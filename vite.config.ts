import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	server: { port: 8788 },
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./app", import.meta.url)),
		},
	},
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
		tailwindcss(),
		tanstackStart({
			router: {
				routesDirectory: "../app/routes",
				generatedRouteTree: "../app/routeTree.gen.ts",
			},
		}),
		react(),
	],
});
