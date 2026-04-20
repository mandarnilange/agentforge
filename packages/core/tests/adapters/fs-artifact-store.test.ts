import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsArtifactStore } from "../../src/adapters/store/fs-artifact.adapter.js";
import type { ArtifactData } from "../../src/domain/models/artifact.model.js";

describe("FsArtifactStore", () => {
	let store: FsArtifactStore;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "fs-artifact-store-"));
		store = new FsArtifactStore();
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("save()", () => {
		it("should create JSON file and Markdown file in output dir", async () => {
			const artifact: ArtifactData = {
				type: "spec",
				path: "requirements.md",
				content: '{"title":"Login Feature","description":"User can log in"}',
			};

			await store.save(artifact, tempDir);

			const files = await readdir(tempDir);
			expect(files).toContain("spec.json");
			expect(files).toContain("spec.md");
		});

		it("should write artifact content to JSON file", async () => {
			const artifact: ArtifactData = {
				type: "code",
				path: "src/index.ts",
				content: '{"module":"index","code":"console.log(\\"hello\\")"}',
				metadata: { language: "typescript" },
			};

			await store.save(artifact, tempDir);

			const jsonContent = await readFile(join(tempDir, "code.json"), "utf-8");
			const parsed = JSON.parse(jsonContent);
			// File saves the parsed artifact content directly (not the wrapper)
			expect(parsed.module).toBe("index");
			expect(parsed.code).toBe('console.log("hello")');
		});

		it("should create a human-readable markdown file", async () => {
			const artifact: ArtifactData = {
				type: "spec",
				path: "spec.md",
				content: '{"title":"Feature X","requirements":["req1","req2"]}',
			};

			await store.save(artifact, tempDir);

			const mdContent = await readFile(join(tempDir, "spec.md"), "utf-8");
			expect(mdContent).toContain("# spec");
			expect(mdContent.length).toBeGreaterThan(0);
		});

		it("should create _metadata.json with run info", async () => {
			const artifact: ArtifactData = {
				type: "spec",
				path: "spec.md",
				content: "spec content",
			};

			await store.save(artifact, tempDir);

			const metaContent = await readFile(
				join(tempDir, "_metadata.json"),
				"utf-8",
			);
			const meta = JSON.parse(metaContent);
			expect(meta.artifactCount).toBe(1);
			expect(meta.lastUpdated).toBeDefined();
			expect(meta.artifacts).toHaveLength(1);
			expect(meta.artifacts[0].type).toBe("spec");
		});

		it("should update _metadata.json when saving multiple artifacts", async () => {
			await store.save(
				{ type: "spec", path: "spec.md", content: "spec" },
				tempDir,
			);
			await store.save(
				{ type: "code", path: "index.ts", content: "code" },
				tempDir,
			);

			const metaContent = await readFile(
				join(tempDir, "_metadata.json"),
				"utf-8",
			);
			const meta = JSON.parse(metaContent);
			expect(meta.artifactCount).toBe(2);
			expect(meta.artifacts).toHaveLength(2);
		});

		it("should return SavedArtifact with file path", async () => {
			const artifact: ArtifactData = {
				type: "code",
				path: "src/index.ts",
				content: "code content",
			};

			const saved = await store.save(artifact, tempDir);

			expect(saved.type).toBe("code");
			expect(saved.path).toBe("src/index.ts");
			expect(saved.absolutePath).toBe(join(tempDir, "code.json"));
			expect(saved.size).toBeGreaterThan(0);
			expect(saved.createdAt).toBeDefined();
		});
	});

	describe("load()", () => {
		it("should read all .json files from directory except _metadata.json", async () => {
			await store.save(
				{ type: "spec", path: "spec.md", content: '{"a":1}' },
				tempDir,
			);
			await store.save(
				{ type: "code", path: "index.ts", content: '{"b":2}' },
				tempDir,
			);

			const artifacts = await store.load({ pathPattern: tempDir });

			expect(artifacts).toHaveLength(2);
			const types = artifacts.map((a) => a.type);
			expect(types).toContain("spec");
			expect(types).toContain("code");
		});

		it("should filter by type when specified", async () => {
			await store.save(
				{ type: "spec", path: "spec.md", content: "spec" },
				tempDir,
			);
			await store.save(
				{ type: "code", path: "index.ts", content: "code" },
				tempDir,
			);
			await store.save(
				{ type: "test", path: "test.ts", content: "test" },
				tempDir,
			);

			const artifacts = await store.load({
				pathPattern: tempDir,
				type: "code",
			});

			expect(artifacts).toHaveLength(1);
			expect(artifacts[0].type).toBe("code");
		});

		it("should return empty array for empty directory", async () => {
			const artifacts = await store.load({ pathPattern: tempDir });
			expect(artifacts).toEqual([]);
		});
	});

	describe("list()", () => {
		it("should return metadata for all artifacts in a directory", async () => {
			await store.save(
				{ type: "spec", path: "spec.md", content: "spec content" },
				tempDir,
			);
			await store.save(
				{ type: "code", path: "index.ts", content: "code content" },
				tempDir,
			);

			const metadataList = await store.list(tempDir);

			expect(metadataList).toHaveLength(2);
			for (const meta of metadataList) {
				expect(meta.path).toBeDefined();
				expect(meta.type).toBeDefined();
				expect(meta.size).toBeGreaterThan(0);
				expect(meta.createdAt).toBeDefined();
			}
		});

		it("should return empty array for directory with no artifacts", async () => {
			const metadataList = await store.list(tempDir);
			expect(metadataList).toEqual([]);
		});
	});

	describe("roundtrip", () => {
		it("should save then load and return same data", async () => {
			const original: ArtifactData = {
				type: "spec",
				path: "requirements.md",
				content: '{"title":"Feature","description":"A feature"}',
			};

			await store.save(original, tempDir);
			const loaded = await store.load({ pathPattern: tempDir });

			expect(loaded).toHaveLength(1);
			expect(loaded[0].type).toBe(original.type);
			// Content round-trips through JSON parse/stringify (may be reformatted)
			const originalParsed = JSON.parse(original.content);
			const loadedParsed = JSON.parse(loaded[0].content);
			expect(loadedParsed).toEqual(originalParsed);
		});
	});
});
