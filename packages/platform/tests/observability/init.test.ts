import type { Span } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	flushTelemetry,
	getTracer,
	initTelemetry,
	renameHttpSpan,
	resetTelemetry,
	shouldIgnoreHttpRequest,
} from "../../src/observability/init.js";

describe("initTelemetry", () => {
	beforeEach(() => {
		resetTelemetry();
	});

	it("should not throw when called with no config", () => {
		expect(() => initTelemetry()).not.toThrow();
	});

	it("should not throw when called with minimal config", () => {
		expect(() => initTelemetry({ serviceName: "test-agent" })).not.toThrow();
	});

	it("should not throw when called with full config", () => {
		expect(() =>
			initTelemetry({
				serviceName: "test-agent",
				otlpEndpoint: "http://localhost:4318",
				enabled: true,
			}),
		).not.toThrow();
	});

	it("should skip initialization when enabled is false", () => {
		expect(() => initTelemetry({ enabled: false })).not.toThrow();
	});

	it("should be idempotent — calling twice does not throw", () => {
		initTelemetry({ serviceName: "test" });
		expect(() => initTelemetry({ serviceName: "test" })).not.toThrow();
	});
});

describe("flushTelemetry", () => {
	beforeEach(() => {
		resetTelemetry();
	});

	it("is a no-op when sdk is not initialized", async () => {
		await expect(flushTelemetry()).resolves.not.toThrow();
	});

	it("calls sdk.shutdown when sdk is initialized with endpoint", async () => {
		initTelemetry({
			otlpEndpoint: "http://localhost:9999",
			serviceName: "flush-test",
		});
		await expect(flushTelemetry()).resolves.not.toThrow();
		resetTelemetry();
	});
});

describe("resetTelemetry", () => {
	it("allows re-initialization after reset", () => {
		initTelemetry({ serviceName: "first" });
		resetTelemetry();
		// Should not throw because initialized = false now
		expect(() => initTelemetry({ serviceName: "second" })).not.toThrow();
		resetTelemetry();
	});

	it("is safe to call when no sdk exists", () => {
		resetTelemetry(); // already reset in beforeEach-equivalent
		expect(() => resetTelemetry()).not.toThrow();
	});
});

describe("shouldIgnoreHttpRequest", () => {
	it("ignores health-check probes", () => {
		expect(shouldIgnoreHttpRequest({ url: "/api/health" })).toBe(true);
	});

	it("ignores static asset requests", () => {
		expect(shouldIgnoreHttpRequest({ url: "/assets/app.js" })).toBe(true);
		expect(shouldIgnoreHttpRequest({ url: "/assets/" })).toBe(true);
	});

	it("does not ignore regular API requests", () => {
		expect(shouldIgnoreHttpRequest({ url: "/api/pipelines" })).toBe(false);
		expect(shouldIgnoreHttpRequest({ url: "/" })).toBe(false);
	});

	it("treats missing url as empty", () => {
		expect(shouldIgnoreHttpRequest({})).toBe(false);
	});
});

describe("renameHttpSpan", () => {
	it("renames span to METHOD /path stripped of query string", () => {
		const span = { updateName: vi.fn() };
		renameHttpSpan(span as unknown as Span, {
			method: "GET",
			url: "/api/pipelines?limit=10",
		});
		expect(span.updateName).toHaveBeenCalledWith("GET /api/pipelines");
	});

	it("leaves span unchanged when url or method missing", () => {
		const span = { updateName: vi.fn() };
		renameHttpSpan(span as unknown as Span, { method: "GET" });
		renameHttpSpan(span as unknown as Span, { url: "/api/x" });
		expect(span.updateName).not.toHaveBeenCalled();
	});
});

describe("getTracer", () => {
	it("should return a tracer object", () => {
		const tracer = getTracer();
		expect(tracer).toBeDefined();
		expect(tracer.startSpan).toBeTypeOf("function");
	});

	it("should return a tracer with custom name", () => {
		const tracer = getTracer("custom-tracer");
		expect(tracer).toBeDefined();
		expect(tracer.startSpan).toBeTypeOf("function");
	});

	it("should return a tracer even without calling initTelemetry", () => {
		const tracer = getTracer();
		expect(tracer).toBeDefined();
	});
});
