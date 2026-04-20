import { z } from "zod/v4";

export const CoverageReportSchema = z.object({
	lineCoverage: z.number().min(0).max(100),
	branchCoverage: z.number().min(0).max(100),
	functionCoverage: z.number().min(0).max(100),
	statementCoverage: z.number().min(0).max(100),
	summary: z.string(),
});

export type CoverageReport = z.infer<typeof CoverageReportSchema>;
