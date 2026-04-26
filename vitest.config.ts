import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@mandarnilange/agentforge-core": resolve(__dirname, "packages/core/src"),
		},
	},
	test: {
		globals: true,
		include: ["packages/*/tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.ts"],
			exclude: [
				// React/Vite frontend — has its own test setup in dashboard/app
				"packages/core/src/dashboard/app/**",
				// CLI entry points — just wire up Commander, no testable logic
				"packages/core/src/cli/index.ts",
				"packages/platform/src/platform-cli.ts",
				// OTel preload — runs at process start, not unit-testable
				"packages/platform/src/observability/preload.ts",
			],
		},
	},
});
