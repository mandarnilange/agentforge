/**
 * IRateLimiter — checks pipeline resource limits before scheduling.
 */

import type { LimitViolation } from "../models/rate-limits.model.js";

export interface IRateLimiter {
	checkLimits(pipelineRunId: string): Promise<LimitViolation[]>;
}
