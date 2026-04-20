import { z } from "zod/v4";

const TechChoiceSchema = z.object({
	category: z.string(),
	choice: z.string(),
	justification: z.string(),
	alternatives: z.array(z.string()).optional(),
});

export const TechStackRecSchema = z.object({
	frontend: z.array(TechChoiceSchema).optional(),
	backend: z.array(TechChoiceSchema).optional(),
	database: z.array(TechChoiceSchema).optional(),
	infrastructure: z.array(TechChoiceSchema).optional(),
	devops: z.array(TechChoiceSchema).optional(),
	other: z.array(TechChoiceSchema).optional(),
	summary: z.string().optional(),
});

export type TechStackRecommendation = z.infer<typeof TechStackRecSchema>;
