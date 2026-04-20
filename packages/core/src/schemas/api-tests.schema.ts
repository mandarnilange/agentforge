import { z } from "zod/v4";

const TestFileSchema = z
	.object({
		path: z.string(),
		description: z.string().optional(),
		testCount: z.number().optional(),
	})
	.passthrough();

const CoverageTargetsSchema = z.object({
	statements: z.number().optional(),
	branches: z.number().optional(),
	functions: z.number().optional(),
	lines: z.number().optional(),
});

export const ApiTestsSchema = z.object({
	testFiles: z.array(TestFileSchema).min(1),
	framework: z.string(),
	coverageTargets: CoverageTargetsSchema.optional(),
});

export type ApiTests = z.infer<typeof ApiTestsSchema>;
