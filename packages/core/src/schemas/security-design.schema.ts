import { z } from "zod/v4";

const AuthPatternSchema = z.object({
	type: z.string(),
	description: z.string().optional(),
	tokenStrategy: z.string().optional(),
	sessionManagement: z.string().optional(),
});

const EncryptionSchema = z.object({
	atRest: z.string(),
	inTransit: z.string(),
	keyManagement: z.string().optional(),
});

const DataProtectionSchema = z.object({
	category: z.string(),
	measures: z.array(z.string()),
});

const ThreatSchema = z.object({
	id: z.string().optional(),
	name: z.string(),
	severity: z.string(),
	mitigation: z.string(),
});

export const SecurityDesignSchema = z.object({
	authPattern: AuthPatternSchema,
	encryption: EncryptionSchema,
	dataProtection: z.array(DataProtectionSchema).optional(),
	threats: z.array(ThreatSchema).optional(),
	complianceRequirements: z.array(z.string()).optional(),
	apiSecurity: z.string().optional(),
	auditLogging: z.string().optional(),
	notes: z.string().optional(),
});

export type SecurityDesign = z.infer<typeof SecurityDesignSchema>;
