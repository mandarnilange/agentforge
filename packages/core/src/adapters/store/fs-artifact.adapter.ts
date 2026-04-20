/**
 * FsArtifactStore — file system implementation of IArtifactStore.
 * Persists artifacts as JSON + Markdown files on disk.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	ArtifactData,
	ArtifactMetadata,
	ArtifactQuery,
	SavedArtifact,
} from "../../domain/models/artifact.model.js";
import type { IArtifactStore } from "../../domain/ports/artifact-store.port.js";

interface MetadataFile {
	lastUpdated: string;
	artifactCount: number;
	artifacts: ArtifactMetadata[];
}

export class FsArtifactStore implements IArtifactStore {
	async save(
		artifact: ArtifactData,
		outputDir: string,
	): Promise<SavedArtifact> {
		await mkdir(outputDir, { recursive: true });

		const jsonFileName = `${artifact.type}.json`;
		const mdFileName = `${artifact.type}.md`;
		const jsonPath = join(outputDir, jsonFileName);
		const mdPath = join(outputDir, mdFileName);

		// Write artifact content as JSON — save the actual content, not the wrapper
		let jsonPayload: string;
		try {
			// If content is a JSON string, parse and re-serialize for pretty formatting
			const parsed = JSON.parse(artifact.content);
			jsonPayload = JSON.stringify(parsed, null, 2);
		} catch {
			// Content is not JSON — wrap it
			jsonPayload = JSON.stringify(
				{ type: artifact.type, content: artifact.content },
				null,
				2,
			);
		}
		await writeFile(jsonPath, jsonPayload, "utf-8");

		// Write human-readable markdown
		const mdContent = this.toMarkdown(artifact);
		await writeFile(mdPath, mdContent, "utf-8");

		// Update _metadata.json
		const metadataPath = join(outputDir, "_metadata.json");
		const existingMeta = await this.readMetadataFile(metadataPath);
		const now = new Date().toISOString();
		const fileStats = await stat(jsonPath);

		const artifactMeta: ArtifactMetadata = {
			path: artifact.path,
			type: artifact.type,
			size: fileStats.size,
			createdAt: now,
		};

		existingMeta.artifacts.push(artifactMeta);
		existingMeta.artifactCount = existingMeta.artifacts.length;
		existingMeta.lastUpdated = now;

		await writeFile(
			metadataPath,
			JSON.stringify(existingMeta, null, 2),
			"utf-8",
		);

		return {
			path: artifact.path,
			type: artifact.type,
			size: fileStats.size,
			createdAt: now,
			absolutePath: jsonPath,
		};
	}

	async load(query: ArtifactQuery): Promise<ArtifactData[]> {
		const dir = query.pathPattern;
		if (!dir) {
			return [];
		}

		let files: string[];
		try {
			files = await readdir(dir);
		} catch {
			return [];
		}

		const jsonFiles = files.filter(
			(f) => f.endsWith(".json") && f !== "_metadata.json",
		);

		const artifacts: ArtifactData[] = [];
		for (const file of jsonFiles) {
			const raw = await readFile(join(dir, file), "utf-8");
			const type = file.replace(/\.json$/, "");
			if (query.type && type !== query.type) {
				continue;
			}
			artifacts.push({
				type: type as ArtifactData["type"],
				path: `${type}.json`,
				content: raw,
			});
		}

		return artifacts;
	}

	async list(dir: string): Promise<ArtifactMetadata[]> {
		const metadataPath = join(dir, "_metadata.json");
		const meta = await this.readMetadataFile(metadataPath);
		return meta.artifacts;
	}

	private async readMetadataFile(path: string): Promise<MetadataFile> {
		try {
			const raw = await readFile(path, "utf-8");
			return JSON.parse(raw) as MetadataFile;
		} catch {
			return { lastUpdated: "", artifactCount: 0, artifacts: [] };
		}
	}

	private toMarkdown(artifact: ArtifactData): string {
		const lines: string[] = [`# ${artifact.type}`, ""];
		lines.push(`**Path:** ${artifact.path}`, "");

		try {
			const obj = JSON.parse(artifact.content);
			this.renderValue(obj, 2, lines);
		} catch {
			lines.push("## Content", "", artifact.content, "");
		}

		return lines.join("\n");
	}

	private renderValue(
		value: unknown,
		headingLevel: number,
		lines: string[],
	): void {
		if (value === null || value === undefined) {
			return;
		}

		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			lines.push(String(value), "");
			return;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				if (
					typeof item === "string" ||
					typeof item === "number" ||
					typeof item === "boolean"
				) {
					lines.push(`- ${item}`);
				} else if (typeof item === "object" && item !== null) {
					// Render object items with key fields as summary, rest as details
					const obj = item as Record<string, unknown>;
					const title = obj.title ?? obj.name ?? obj.id ?? obj.category ?? "";
					if (title) {
						const hashes = "#".repeat(Math.min(headingLevel + 1, 6));
						lines.push("", `${hashes} ${title}`, "");
						for (const [k, v] of Object.entries(obj)) {
							if (k === "title" || k === "name") continue;
							if (
								typeof v === "string" ||
								typeof v === "number" ||
								typeof v === "boolean"
							) {
								lines.push(`- **${k}:** ${v}`);
							} else if (Array.isArray(v)) {
								lines.push(`- **${k}:**`);
								for (const sub of v) {
									if (typeof sub === "string" || typeof sub === "number") {
										lines.push(`  - ${sub}`);
									} else {
										lines.push(`  - ${JSON.stringify(sub)}`);
									}
								}
							} else if (v !== null && typeof v === "object") {
								lines.push(`- **${k}:**`);
								for (const [sk, sv] of Object.entries(
									v as Record<string, unknown>,
								)) {
									lines.push(
										`  - **${sk}:** ${typeof sv === "object" ? JSON.stringify(sv) : sv}`,
									);
								}
							}
						}
					} else {
						lines.push(`\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``);
					}
					lines.push("");
				}
			}
			lines.push("");
			return;
		}

		if (typeof value === "object") {
			for (const [key, val] of Object.entries(
				value as Record<string, unknown>,
			)) {
				const hashes = "#".repeat(Math.min(headingLevel, 6));
				lines.push(`${hashes} ${key}`, "");
				this.renderValue(val, headingLevel + 1, lines);
			}
		}
	}
}
