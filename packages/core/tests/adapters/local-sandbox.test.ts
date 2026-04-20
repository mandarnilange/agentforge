import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type LocalSandbox,
	LocalSandboxProvider,
} from "../../src/adapters/sandbox/local-sandbox.adapter.js";
import type {
	ISandbox,
	ISandboxProvider,
} from "../../src/domain/ports/sandbox.port.js";

describe("LocalSandboxProvider", () => {
	let provider: LocalSandboxProvider;

	beforeEach(() => {
		provider = new LocalSandboxProvider();
	});

	it("should implement ISandboxProvider interface", () => {
		const typed: ISandboxProvider = provider;
		expect(typed.create).toBeTypeOf("function");
	});

	describe("create()", () => {
		let sandbox: ISandbox;

		afterEach(async () => {
			if (sandbox) {
				await sandbox.destroy();
			}
		});

		it("should return an ISandbox instance", async () => {
			sandbox = await provider.create({ image: "ignored" });

			expect(sandbox).toBeDefined();
			expect(sandbox.run).toBeTypeOf("function");
			expect(sandbox.writeFile).toBeTypeOf("function");
			expect(sandbox.readFile).toBeTypeOf("function");
			expect(sandbox.copyIn).toBeTypeOf("function");
			expect(sandbox.copyOut).toBeTypeOf("function");
			expect(sandbox.destroy).toBeTypeOf("function");
		});

		it("should log a warning about no isolation", async () => {
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			sandbox = await provider.create({ image: "ignored" });
			expect(warnSpy).toHaveBeenCalledWith(
				expect.stringContaining("no isolation"),
			);
			warnSpy.mockRestore();
		});
	});
});

describe("LocalSandbox", () => {
	let sandbox: ISandbox;
	let _workdir: string;

	beforeEach(async () => {
		_workdir = await mkdtemp(join(tmpdir(), "local-sandbox-test-"));
		const provider = new LocalSandboxProvider();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		sandbox = await provider.create({ image: "ignored" });
		warnSpy.mockRestore();
	});

	afterEach(async () => {
		await sandbox.destroy();
	});

	describe("run()", () => {
		it("should execute a command and return result", async () => {
			const result = await sandbox.run("echo hello");
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("hello");
			expect(result.stderr).toBe("");
		});

		it("should capture stderr", async () => {
			const result = await sandbox.run("echo error >&2");
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("error");
		});

		it("should return non-zero exit code on failure", async () => {
			const result = await sandbox.run("exit 42");
			expect(result.exitCode).toBe(42);
		});

		it("should respect cwd option", async () => {
			const result = await sandbox.run("pwd", { cwd: "/tmp" });
			// The result should contain /tmp (or a resolved path on macOS)
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toMatch(/tmp/);
		});

		it("should respect env option", async () => {
			const result = await sandbox.run("echo $MY_VAR", {
				env: { MY_VAR: "test_value" },
			});
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("test_value");
		});
	});

	describe("writeFile() / readFile()", () => {
		it("should roundtrip string content", async () => {
			await sandbox.writeFile("test.txt", "hello world");
			const content = await sandbox.readFile("test.txt");
			expect(content).toBe("hello world");
		});

		it("should roundtrip Buffer content", async () => {
			const buf = Buffer.from("binary data");
			await sandbox.writeFile("binary.dat", buf);
			const content = await sandbox.readFile("binary.dat");
			expect(content).toBe("binary data");
		});

		it("should create nested directories for writeFile", async () => {
			await sandbox.writeFile("nested/dir/file.txt", "deep content");
			const content = await sandbox.readFile("nested/dir/file.txt");
			expect(content).toBe("deep content");
		});
	});

	describe("copyIn() / copyOut()", () => {
		let srcDir: string;

		beforeEach(async () => {
			srcDir = await mkdtemp(join(tmpdir(), "local-sandbox-src-"));
		});

		afterEach(async () => {
			await rm(srcDir, { recursive: true, force: true });
		});

		it("should copy a file into the sandbox", async () => {
			const { writeFile: fsWriteFile } = await import("node:fs/promises");
			const srcFile = join(srcDir, "input.txt");
			await fsWriteFile(srcFile, "copied content");

			await sandbox.copyIn(srcFile, "input.txt");
			const content = await sandbox.readFile("input.txt");
			expect(content).toBe("copied content");
		});

		it("should copy a file out of the sandbox", async () => {
			await sandbox.writeFile("output.txt", "sandbox content");
			const destFile = join(srcDir, "output.txt");

			await sandbox.copyOut("output.txt", destFile);
			const content = await readFile(destFile, "utf-8");
			expect(content).toBe("sandbox content");
		});
	});

	describe("destroy()", () => {
		it("should clean up workdir", async () => {
			const localSandbox = sandbox as LocalSandbox;
			const dir = localSandbox.workdir;

			await sandbox.writeFile("file.txt", "content");
			await sandbox.destroy();

			// After destroy, reading should fail because workdir is gone
			const { access } = await import("node:fs/promises");
			await expect(access(dir)).rejects.toThrow();
		});
	});
});
