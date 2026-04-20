import { z } from "zod/v4";

const ResponseTimeSchema = z.object({
	p95: z.string(),
	p99: z.string().optional(),
});

const PerformanceSchema = z.object({
	responseTime: ResponseTimeSchema,
	throughput: z.string(),
	concurrentUsers: z.number(),
});

const SecuritySchema = z.object({
	authentication: z.string(),
	authorization: z.string(),
	dataEncryption: z.string(),
	additionalRequirements: z.array(z.string()).optional(),
});

const ScalabilitySchema = z.object({
	horizontalScaling: z.boolean(),
	expectedGrowth: z.string(),
	strategy: z.string().optional(),
});

const AvailabilitySchema = z.object({
	uptime: z.string(),
	rto: z.string().optional(),
	rpo: z.string().optional(),
	disasterRecovery: z.string().optional(),
});

const ComplianceSchema = z.object({
	gdpr: z.boolean(),
	wcagLevel: z.enum(["A", "AA", "AAA"]).optional(),
	additionalStandards: z.array(z.string()).optional(),
});

const MaintainabilitySchema = z.object({
	codeQuality: z.string(),
	testCoverage: z.string(),
	documentation: z.string().optional(),
});

export const NfrSchema = z.object({
	performance: PerformanceSchema,
	security: SecuritySchema,
	scalability: ScalabilitySchema,
	availability: AvailabilitySchema,
	compliance: ComplianceSchema,
	maintainability: MaintainabilitySchema,
});

export type NFR = z.infer<typeof NfrSchema>;
