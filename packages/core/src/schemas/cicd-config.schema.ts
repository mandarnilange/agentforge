import { z } from "zod/v4";

const CicdFileSchema = z
	.object({
		path: z.string(),
		description: z.string(),
		content: z.string(),
	})
	.passthrough();

export const CicdConfigSchema = z.object({
	platform: z.string(),
	files: z.array(CicdFileSchema).min(1),
	stages: z.array(z.string()),
});

export type CicdConfig = z.infer<typeof CicdConfigSchema>;
