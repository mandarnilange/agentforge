import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import { GitRepoManager } from "../../src/adapters/git/repo-manager.js";

describe("GitRepoManager", () => {
	let manager: GitRepoManager;
	let tempDir: string;

	beforeAll(() => {
		// Disable git commit signing in this test environment
		process.env.GIT_CONFIG_COUNT = "1";
		process.env.GIT_CONFIG_KEY_0 = "commit.gpgsign";
		process.env.GIT_CONFIG_VALUE_0 = "false";
	});

	afterAll(() => {
		delete process.env.GIT_CONFIG_COUNT;
		delete process.env.GIT_CONFIG_KEY_0;
		delete process.env.GIT_CONFIG_VALUE_0;
	});

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "git-repo-manager-"));
		manager = new GitRepoManager();
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("initRepo()", () => {
		it("creates a fresh Git repo at the given path", async () => {
			const repoPath = join(tempDir, "my-project");
			await manager.initRepo(repoPath, "my-project");

			const log = await manager.log(repoPath, 1);
			expect(log).toHaveLength(1);
			expect(log[0]).toContain("init: my-project");
		});

		it("creates nested directories if needed", async () => {
			const repoPath = join(tempDir, "a", "b", "c", "project");
			await manager.initRepo(repoPath, "nested-project");

			const log = await manager.log(repoPath, 1);
			expect(log).toHaveLength(1);
		});

		it("initial commit message includes project name", async () => {
			const repoPath = join(tempDir, "named");
			await manager.initRepo(repoPath, "cool-app");

			const log = await manager.log(repoPath, 1);
			expect(log[0]).toContain("cool-app");
		});
	});

	describe("commit()", () => {
		it("commits all files when no specific files provided", async () => {
			const repoPath = join(tempDir, "commit-all");
			await manager.initRepo(repoPath, "test");

			await writeFile(join(repoPath, "hello.txt"), "world");
			const sha = await manager.commit(repoPath, "add hello");

			expect(sha).toMatch(/^[0-9a-f]{40}$/);

			const log = await manager.log(repoPath, 2);
			expect(log).toHaveLength(2);
			expect(log[0]).toContain("add hello");
		});

		it("commits only specified files", async () => {
			const repoPath = join(tempDir, "commit-specific");
			await manager.initRepo(repoPath, "test");

			await writeFile(join(repoPath, "a.txt"), "aaa");
			await writeFile(join(repoPath, "b.txt"), "bbb");
			const sha = await manager.commit(repoPath, "add a only", ["a.txt"]);

			expect(sha).toMatch(/^[0-9a-f]{40}$/);

			const log = await manager.log(repoPath, 2);
			expect(log[0]).toContain("add a only");
		});

		it("returns the commit SHA", async () => {
			const repoPath = join(tempDir, "sha-test");
			await manager.initRepo(repoPath, "test");

			await writeFile(join(repoPath, "file.txt"), "content");
			const sha = await manager.commit(repoPath, "test commit");

			expect(typeof sha).toBe("string");
			expect(sha).toHaveLength(40);
		});
	});

	describe("log()", () => {
		it("returns the requested number of log entries", async () => {
			const repoPath = join(tempDir, "log-test");
			await manager.initRepo(repoPath, "test");

			await writeFile(join(repoPath, "a.txt"), "a");
			await manager.commit(repoPath, "first");

			await writeFile(join(repoPath, "b.txt"), "b");
			await manager.commit(repoPath, "second");

			await writeFile(join(repoPath, "c.txt"), "c");
			await manager.commit(repoPath, "third");

			const log = await manager.log(repoPath, 2);
			expect(log).toHaveLength(2);
			expect(log[0]).toContain("third");
			expect(log[1]).toContain("second");
		});

		it("defaults to 5 entries", async () => {
			const repoPath = join(tempDir, "log-default");
			await manager.initRepo(repoPath, "test");

			const log = await manager.log(repoPath);
			expect(log.length).toBeLessThanOrEqual(5);
			expect(log.length).toBeGreaterThanOrEqual(1);
		});
	});
});
