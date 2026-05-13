/**
 * Tests for SSH node preflight (P40-T6).
 *
 * On platform startup, ssh-typed node definitions get a lightweight reach
 * check via runtime.ping(). Unreachable nodes log a warning and are marked
 * offline in the registry instead of silently appearing healthy until the
 * first scheduled job fails.
 */
import type { NodeDefinitionYaml } from "@mandarnilange/agentforge-core/definitions/parser.js";
import type { INodeRuntime } from "@mandarnilange/agentforge-core/domain/ports/node-runtime.port.js";
import { describe, expect, it, vi } from "vitest";
import { validateSshNodesAtStartup } from "../../src/nodes/ssh-preflight.js";

function sshDef(name: string, host = "host.example"): NodeDefinitionYaml {
	return {
		apiVersion: "agentforge.dev/v1",
		kind: "NodeDefinition",
		metadata: { name, type: "remote" },
		spec: {
			capabilities: ["llm-access"],
			connection: { type: "ssh", host, user: "agent" },
		},
	} as NodeDefinitionYaml;
}

function localDef(name: string): NodeDefinitionYaml {
	return {
		apiVersion: "agentforge.dev/v1",
		kind: "NodeDefinition",
		metadata: { name, type: "local" },
		spec: { capabilities: ["llm-access"] },
	} as NodeDefinitionYaml;
}

function fakeRuntime(
	def: NodeDefinitionYaml,
	pingResult: boolean,
): INodeRuntime {
	return {
		nodeDefinition: def,
		ping: vi.fn().mockResolvedValue(pingResult),
		execute: vi.fn(),
	} as unknown as INodeRuntime;
}

describe("validateSshNodesAtStartup()", () => {
	it("only pings ssh-typed nodes (skips local)", async () => {
		const localRt = fakeRuntime(localDef("alpha"), true);
		const sshRt = fakeRuntime(sshDef("beta"), true);
		const warn = vi.fn();
		const markOffline = vi.fn();
		await validateSshNodesAtStartup({
			runtimes: [localRt, sshRt],
			warn,
			markOffline,
		});
		expect(localRt.ping).not.toHaveBeenCalled();
		expect(sshRt.ping).toHaveBeenCalledOnce();
	});

	it("marks unreachable ssh nodes offline and warns", async () => {
		const sshRt = fakeRuntime(sshDef("beta", "10.0.0.99"), false);
		const warn = vi.fn();
		const markOffline = vi.fn();
		await validateSshNodesAtStartup({
			runtimes: [sshRt],
			warn,
			markOffline,
		});
		expect(markOffline).toHaveBeenCalledWith("beta");
		expect(warn).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/ssh.*beta.*unreachable/i),
		);
	});

	it("does not warn or mark offline when ssh is reachable", async () => {
		const sshRt = fakeRuntime(sshDef("beta"), true);
		const warn = vi.fn();
		const markOffline = vi.fn();
		await validateSshNodesAtStartup({
			runtimes: [sshRt],
			warn,
			markOffline,
		});
		expect(markOffline).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it("returns a structured report of node names and reachability", async () => {
		const ok = fakeRuntime(sshDef("ok"), true);
		const bad = fakeRuntime(sshDef("bad"), false);
		const result = await validateSshNodesAtStartup({
			runtimes: [ok, bad],
			warn: vi.fn(),
			markOffline: vi.fn(),
		});
		expect(result).toEqual([
			{ name: "ok", reachable: true },
			{ name: "bad", reachable: false },
		]);
	});

	it("treats ping rejection as unreachable rather than throwing", async () => {
		const sshRt = {
			nodeDefinition: sshDef("beta"),
			ping: vi.fn().mockRejectedValue(new Error("auth failed")),
			execute: vi.fn(),
		} as unknown as INodeRuntime;
		const warn = vi.fn();
		const markOffline = vi.fn();
		const result = await validateSshNodesAtStartup({
			runtimes: [sshRt],
			warn,
			markOffline,
		});
		expect(result).toEqual([{ name: "beta", reachable: false }]);
		expect(markOffline).toHaveBeenCalledWith("beta");
		expect(warn).toHaveBeenCalledOnce();
	});
});
