import { describe, expect, it, vi } from "vitest";
import {
	humanizeErrorMessage,
	isOverloadedError,
	retryWithBackoff,
} from "../../../src/adapters/execution/retry.js";

describe("isOverloadedError", () => {
	it("detects plain overloaded_error in error message", () => {
		expect(isOverloadedError(new Error("overloaded_error"))).toBe(true);
	});

	it("detects overloaded_error inside JSON-stringified payload", () => {
		const err = new Error(
			JSON.stringify({
				error: { type: "overloaded_error", message: "Overloaded" },
			}),
		);
		expect(isOverloadedError(err)).toBe(true);
	});

	it("detects HTTP 529 status codes", () => {
		const err = new Error(JSON.stringify({ statusCode: 529 }));
		expect(isOverloadedError(err)).toBe(true);
	});

	it("returns false for unrelated errors", () => {
		expect(isOverloadedError(new Error("rate_limit_error"))).toBe(false);
		expect(isOverloadedError(new Error("something random"))).toBe(false);
	});

	it("handles non-Error values", () => {
		expect(isOverloadedError("overloaded_error: server busy")).toBe(true);
		expect(isOverloadedError(null)).toBe(false);
		expect(isOverloadedError(undefined)).toBe(false);
	});
});

describe("humanizeErrorMessage", () => {
	it("returns the raw message for plain errors", () => {
		expect(humanizeErrorMessage(new Error("boom"))).toBe("boom");
	});

	it("extracts .error.message from JSON-encoded payload", () => {
		const err = new Error(
			JSON.stringify({
				error: { type: "overloaded_error", message: "Overloaded" },
			}),
		);
		expect(humanizeErrorMessage(err)).toBe("Overloaded");
	});

	it("falls back to error.type when message missing", () => {
		const err = new Error(
			JSON.stringify({ error: { type: "overloaded_error" } }),
		);
		expect(humanizeErrorMessage(err)).toBe("overloaded_error");
	});

	it("returns a default message for null/undefined", () => {
		expect(humanizeErrorMessage(undefined)).toBe("undefined");
	});
});

describe("retryWithBackoff", () => {
	it("returns result on first success without retry", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const shouldRetry = vi.fn().mockReturnValue(true);
		const result = await retryWithBackoff(fn, shouldRetry);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
		expect(shouldRetry).not.toHaveBeenCalled();
	});

	it("retries on matching errors then succeeds", async () => {
		const err = new Error("overloaded_error");
		const fn = vi
			.fn()
			.mockRejectedValueOnce(err)
			.mockRejectedValueOnce(err)
			.mockResolvedValueOnce("done");

		const onRetry = vi.fn();
		const result = await retryWithBackoff(fn, isOverloadedError, {
			initialBackoffMs: 1,
			onRetry,
		});
		expect(result).toBe("done");
		expect(fn).toHaveBeenCalledTimes(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
	});

	it("does not retry when shouldRetry returns false", async () => {
		const err = new Error("auth_failed");
		const fn = vi.fn().mockRejectedValue(err);
		await expect(
			retryWithBackoff(fn, () => false, { initialBackoffMs: 1 }),
		).rejects.toThrow("auth_failed");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("exhausts maxAttempts and throws the last error", async () => {
		const err = new Error("overloaded_error");
		const fn = vi.fn().mockRejectedValue(err);
		await expect(
			retryWithBackoff(fn, isOverloadedError, {
				initialBackoffMs: 1,
				maxAttempts: 3,
			}),
		).rejects.toThrow("overloaded_error");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("uses exponential backoff (2s, 4s, 8s...) by default", async () => {
		const delays: number[] = [];
		const err = new Error("overloaded_error");
		const fn = vi
			.fn()
			.mockRejectedValueOnce(err)
			.mockRejectedValueOnce(err)
			.mockResolvedValueOnce("ok");

		await retryWithBackoff(fn, isOverloadedError, {
			initialBackoffMs: 10,
			backoffMultiplier: 2,
			onRetry: ({ delayMs }) => delays.push(delayMs),
		});
		expect(delays).toEqual([10, 20]);
	});

	it("stops retrying when signal is aborted", async () => {
		const controller = new AbortController();
		const err = new Error("overloaded_error");
		const fn = vi.fn().mockImplementation(async () => {
			controller.abort();
			throw err;
		});
		await expect(
			retryWithBackoff(fn, isOverloadedError, {
				initialBackoffMs: 10,
				signal: controller.signal,
			}),
		).rejects.toThrow();
		// First attempt runs, then sleep rejects due to abort
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
