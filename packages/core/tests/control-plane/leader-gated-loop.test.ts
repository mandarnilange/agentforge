/**
 * Tests for runWhenLeader — the wrapper that wires ILeaderElector into the
 * existing setInterval loops (PipelineRecovery, AgentScheduler) so only one
 * replica executes the body per tick (P45-T5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalLeaderElector } from "../../src/adapters/leader/local-leader-elector.js";
import { runWhenLeader } from "../../src/control-plane/leader-gated-loop.js";
import type { ILeaderElector } from "../../src/domain/ports/leader-elector.port.js";

describe("runWhenLeader", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs the body on each interval when leader", async () => {
		const elector = new LocalLeaderElector();
		const body = vi.fn().mockResolvedValue(undefined);
		const stop = runWhenLeader(elector, "lock-a", body, 1000);

		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(1000);
		expect(body).toHaveBeenCalledTimes(3);
		stop();
	});

	it("skips the body when not leader", async () => {
		const elector: ILeaderElector = {
			acquire: vi.fn().mockResolvedValue(false),
			release: vi.fn().mockResolvedValue(undefined),
			isLeader: vi.fn().mockReturnValue(false),
		};
		const body = vi.fn().mockResolvedValue(undefined);
		const stop = runWhenLeader(elector, "lock-a", body, 1000);

		await vi.advanceTimersByTimeAsync(3000);
		expect(body).not.toHaveBeenCalled();
		stop();
	});

	it("attempts to re-acquire each tick (so a downed leader is replaced)", async () => {
		const acquire = vi.fn().mockResolvedValue(false);
		const elector: ILeaderElector = {
			acquire,
			release: vi.fn().mockResolvedValue(undefined),
			isLeader: vi.fn().mockReturnValue(false),
		};
		const stop = runWhenLeader(elector, "lock-a", async () => {}, 1000);
		await vi.advanceTimersByTimeAsync(3000);
		expect(acquire).toHaveBeenCalledTimes(3);
		stop();
	});

	it("stops triggering body after stop() is called", async () => {
		const elector = new LocalLeaderElector();
		const body = vi.fn().mockResolvedValue(undefined);
		const stop = runWhenLeader(elector, "lock-a", body, 1000);
		await vi.advanceTimersByTimeAsync(1000);
		stop();
		await vi.advanceTimersByTimeAsync(5000);
		expect(body).toHaveBeenCalledTimes(1);
	});

	it("releases the lock when stop() is called", async () => {
		const release = vi.fn().mockResolvedValue(undefined);
		const elector: ILeaderElector = {
			acquire: vi.fn().mockResolvedValue(true),
			release,
			isLeader: vi.fn().mockReturnValue(true),
		};
		const stop = runWhenLeader(elector, "lock-a", async () => {}, 1000);
		await vi.advanceTimersByTimeAsync(1000);
		stop();
		// release runs in background after stop(); drain microtasks
		await vi.runAllTimersAsync();
		expect(release).toHaveBeenCalledWith("lock-a");
	});

	it("swallows body errors so the loop keeps running, logging each one", async () => {
		const elector = new LocalLeaderElector();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const body = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValue(undefined);
		const stop = runWhenLeader(elector, "lock-a", body, 1000);
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(1000);
		expect(body).toHaveBeenCalledTimes(2);
		expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/lock-a.*boom/));
		stop();
		errSpy.mockRestore();
	});

	it("does not start a second tick while the previous one is still running", async () => {
		// Body takes 5 intervals to resolve. Ticks must not overlap, so over
		// 4 intervals we should only ever see 1 invocation in flight.
		const elector = new LocalLeaderElector();
		let running = 0;
		let maxConcurrent = 0;
		const body = vi.fn(async () => {
			running++;
			maxConcurrent = Math.max(maxConcurrent, running);
			await new Promise((r) => setTimeout(r, 5_000));
			running--;
		});
		const stop = runWhenLeader(elector, "lock-a", body, 1_000);
		await vi.advanceTimersByTimeAsync(4_000);
		expect(maxConcurrent).toBe(1);
		stop();
		// drain in-flight body
		await vi.runAllTimersAsync();
	});
});
