/**
 * ILogger — port for structured logging.
 * ZERO external dependencies.
 */

export interface ILogger {
	debug(ctx: Record<string, unknown>, msg: string): void;
	info(ctx: Record<string, unknown>, msg: string): void;
	warn(ctx: Record<string, unknown>, msg: string): void;
	error(ctx: Record<string, unknown>, msg: string): void;
	child(bindings: Record<string, unknown>): ILogger;
}
