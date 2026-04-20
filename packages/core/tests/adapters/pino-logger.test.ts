import { describe, expect, it } from "vitest";
import { PinoLogger } from "../../src/adapters/observability/pino-logger.adapter.js";
import type { ILogger } from "../../src/domain/ports/logger.port.js";

describe("PinoLogger", () => {
	it("should implement ILogger interface", () => {
		const logger: ILogger = new PinoLogger();

		expect(logger.debug).toBeTypeOf("function");
		expect(logger.info).toBeTypeOf("function");
		expect(logger.warn).toBeTypeOf("function");
		expect(logger.error).toBeTypeOf("function");
		expect(logger.child).toBeTypeOf("function");
	});

	describe("child()", () => {
		it("should create a scoped logger that is also an ILogger", () => {
			const logger = new PinoLogger();
			const child = logger.child({ agentId: "spec-writer" });

			expect(child).toBeDefined();
			expect(child.debug).toBeTypeOf("function");
			expect(child.info).toBeTypeOf("function");
			expect(child.warn).toBeTypeOf("function");
			expect(child.error).toBeTypeOf("function");
			expect(child.child).toBeTypeOf("function");
		});

		it("should allow nested child loggers", () => {
			const logger = new PinoLogger();
			const child = logger.child({ agentId: "coder" });
			const grandchild = child.child({ step: "generate" });

			expect(grandchild).toBeDefined();
			expect(grandchild.info).toBeTypeOf("function");
		});
	});

	describe("log methods", () => {
		it("should not throw when calling info()", () => {
			const logger = new PinoLogger({ level: "silent" });
			expect(() => logger.info({ op: "test" }, "info message")).not.toThrow();
		});

		it("should not throw when calling debug()", () => {
			const logger = new PinoLogger({ level: "silent" });
			expect(() => logger.debug({ op: "test" }, "debug message")).not.toThrow();
		});

		it("should not throw when calling warn()", () => {
			const logger = new PinoLogger({ level: "silent" });
			expect(() => logger.warn({ op: "test" }, "warn message")).not.toThrow();
		});

		it("should not throw when calling error()", () => {
			const logger = new PinoLogger({ level: "silent" });
			expect(() => logger.error({ op: "test" }, "error message")).not.toThrow();
		});

		it("should accept context objects with arbitrary keys", () => {
			const logger = new PinoLogger({ level: "silent" });
			expect(() =>
				logger.info(
					{ agentId: "coder", step: "generate", tokens: 1500 },
					"processing",
				),
			).not.toThrow();
		});
	});
});
