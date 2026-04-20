import { z } from "zod/v4";

const TestFileSchema = z
	.object({
		path: z.string(),
		language: z.string(),
		description: z.string(),
		type: z.enum(["unit", "integration", "e2e", "contract"]).optional(),
	})
	.passthrough();

export const TestSuiteSchema = z.object({
	files: z.array(TestFileSchema).min(1),
	framework: z.string(),
	totalTests: z.number().int().nonnegative(),
});

export type TestSuite = z.infer<typeof TestSuiteSchema>;
