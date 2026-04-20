/**
 * PinoLogger — structured logging implementation of ILogger using pino.
 * Pretty-prints in development, outputs JSON in production.
 */

import pino from "pino";
import type { ILogger } from "../../domain/ports/logger.port.js";

export interface PinoLoggerOptions {
	level?: string;
}

export class PinoLogger implements ILogger {
	private readonly logger: pino.Logger;

	constructor(options?: PinoLoggerOptions) {
		const isDev = process.env.NODE_ENV !== "production";
		this.logger = pino({
			level: options?.level ?? (isDev ? "debug" : "info"),
			...(isDev
				? { transport: { target: "pino-pretty", options: { colorize: true } } }
				: {}),
		});
	}

	/** Internal constructor for child loggers wrapping an existing pino instance. */
	private static fromPinoInstance(instance: pino.Logger): PinoLogger {
		const wrapper = Object.create(PinoLogger.prototype) as PinoLogger;
		(wrapper as unknown as { logger: pino.Logger }).logger = instance;
		return wrapper;
	}

	debug(ctx: Record<string, unknown>, msg: string): void {
		this.logger.debug(ctx, msg);
	}

	info(ctx: Record<string, unknown>, msg: string): void {
		this.logger.info(ctx, msg);
	}

	warn(ctx: Record<string, unknown>, msg: string): void {
		this.logger.warn(ctx, msg);
	}

	error(ctx: Record<string, unknown>, msg: string): void {
		this.logger.error(ctx, msg);
	}

	child(bindings: Record<string, unknown>): ILogger {
		return PinoLogger.fromPinoInstance(this.logger.child(bindings));
	}
}
