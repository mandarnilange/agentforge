import { z } from "zod/v4";

const IndexSchema = z
	.object({
		table: z.string(),
		column: z.string(),
		type: z.string(),
		rationale: z.string(),
	})
	.passthrough();

export const IndexingStrategySchema = z.object({
	indexes: z.array(IndexSchema).min(1),
});

export type IndexingStrategy = z.infer<typeof IndexingStrategySchema>;
