/**
 * Tests for docker availability preflight (P40-T5).
 *
 * checkDockerAvailability() probes the docker socket; filterDockerCapability()
 * strips "docker" from the effective capability list when the socket is
 * unreachable so the node still registers, but with truthful capabilities.
 */
import { describe, expect, it, vi } from "vitest";
import {
	checkDockerAvailability,
	filterDockerCapability,
} from "../../src/nodes/docker-availability.js";

describe("checkDockerAvailability()", () => {
	it("returns true when the docker probe succeeds", async () => {
		const probe = vi.fn().mockResolvedValue(true);
		const ok = await checkDockerAvailability({ probe });
		expect(ok).toBe(true);
		expect(probe).toHaveBeenCalledOnce();
	});

	it("returns false when the docker probe rejects", async () => {
		const probe = vi.fn().mockRejectedValue(new Error("ENOENT"));
		const ok = await checkDockerAvailability({ probe });
		expect(ok).toBe(false);
	});

	it("returns false when the docker probe resolves false (timeout / 5xx)", async () => {
		const probe = vi.fn().mockResolvedValue(false);
		const ok = await checkDockerAvailability({ probe });
		expect(ok).toBe(false);
	});
});

describe("filterDockerCapability()", () => {
	it("returns capabilities unchanged when docker is available", () => {
		const warn = vi.fn();
		const out = filterDockerCapability(
			["llm-access", "docker", "gpu"],
			true,
			warn,
		);
		expect(out).toEqual(["llm-access", "docker", "gpu"]);
		expect(warn).not.toHaveBeenCalled();
	});

	it("removes docker and warns once when docker is unavailable", () => {
		const warn = vi.fn();
		const out = filterDockerCapability(
			["llm-access", "docker", "gpu"],
			false,
			warn,
		);
		expect(out).toEqual(["llm-access", "gpu"]);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/docker.*unavailable/i),
		);
	});

	it("is a no-op when docker is not in the capability list", () => {
		const warn = vi.fn();
		const out = filterDockerCapability(["llm-access", "gpu"], false, warn);
		expect(out).toEqual(["llm-access", "gpu"]);
		expect(warn).not.toHaveBeenCalled();
	});
});
