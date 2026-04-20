import type { IncomingMessage } from "node:http";
import type { Span } from "@opentelemetry/api";
import { type Tracer, trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { NodeSDK } from "@opentelemetry/sdk-node";

export interface TelemetryConfig {
	serviceName?: string;
	otlpEndpoint?: string;
	enabled?: boolean;
}

const DEFAULT_SERVICE = "agentforge";

let sdk: NodeSDK | undefined;
let initialized = false;

/** Drops health-check and static-asset requests so traces stay useful. */
export function shouldIgnoreHttpRequest(req: { url?: string }): boolean {
	const url = req.url ?? "";
	return url === "/api/health" || url.startsWith("/assets/");
}

/** Renames the span to "METHOD /path" (strips query string). */
export function renameHttpSpan(span: Span, request: unknown): void {
	const req = request as IncomingMessage;
	if (req.url && req.method) {
		span.updateName(`${req.method} ${req.url.split("?")[0]}`);
	}
}

export function initTelemetry(config: TelemetryConfig = {}): void {
	if (initialized) return;
	initialized = true;

	if (config.enabled === false) return;

	const serviceName = config.serviceName ?? DEFAULT_SERVICE;
	const endpoint =
		config.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

	if (!endpoint) return;

	sdk = new NodeSDK({
		serviceName,
		traceExporter: new OTLPTraceExporter({
			url: `${endpoint}/v1/traces`,
		}),
		instrumentations: [
			new HttpInstrumentation({
				ignoreIncomingRequestHook: shouldIgnoreHttpRequest,
				requestHook: renameHttpSpan,
			}),
			new PgInstrumentation({
				enhancedDatabaseReporting: true,
			}),
		],
	});

	sdk.start();
}

export function getTracer(name = DEFAULT_SERVICE): Tracer {
	return trace.getTracer(name);
}

export async function flushTelemetry(): Promise<void> {
	if (sdk) {
		await sdk.shutdown();
	}
}

export function resetTelemetry(): void {
	initialized = false;
	if (sdk) {
		sdk.shutdown().catch(() => {});
		sdk = undefined;
	}
}
