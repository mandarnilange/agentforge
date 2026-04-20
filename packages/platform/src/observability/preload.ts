/**
 * OTel preload — must be loaded BEFORE any other modules via --import flag.
 * This ensures HTTP/PG modules are patched before they're first imported.
 */
import { initTelemetry } from "./init.js";

initTelemetry();
