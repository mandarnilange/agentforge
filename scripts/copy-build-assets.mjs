#!/usr/bin/env node
// Copies runtime-only assets (YAML, JSON, MD, SPA bundle) into the compiled
// dist/ tree so they ship in the npm tarball alongside tsc output.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function copyTree(src, dest, { filter } = {}) {
	if (!existsSync(src)) return false;
	mkdirSync(dirname(dest), { recursive: true });
	cpSync(src, dest, { recursive: true, filter });
	return true;
}

function onlyAssets(src) {
	if (/\/(node_modules|\.DS_Store)$/.test(src)) return false;
	if (src.endsWith(".ts") || src.endsWith(".tsx")) return false;
	return true;
}

const jobs = [
	{
		label: "core templates",
		src: resolve(repoRoot, "packages/core/src/templates"),
		dest: resolve(repoRoot, "packages/core/dist/templates"),
		filter: (src) => onlyAssets(src),
	},
	{
		label: "platform templates",
		src: resolve(repoRoot, "packages/platform/src/templates"),
		dest: resolve(repoRoot, "packages/platform/dist/templates"),
		filter: (src) => onlyAssets(src),
	},
	{
		label: "dashboard SPA",
		src: resolve(repoRoot, "packages/core/src/dashboard/dist"),
		dest: resolve(repoRoot, "packages/core/dist/dashboard/app"),
	},
];

let copied = 0;
for (const job of jobs) {
	const ok = copyTree(job.src, job.dest, { filter: job.filter });
	console.log(`${ok ? "✓" : "·"} ${job.label}  ${ok ? "→ " + job.dest : "(skipped — source missing)"}`);
	if (ok) copied++;
}

if (copied === 0) {
	console.error("copy-build-assets: nothing to copy — did tsc/vite run first?");
	process.exit(1);
}
