import { z } from "zod/v4";

export const ProjectProposalSchema = z.object({
	executiveSummary: z.string(),
	problemStatement: z.string().optional(),
	scope: z.object({
		inScope: z.array(z.string()),
		outOfScope: z.array(z.string()).optional(),
	}),
	timeline: z.string(),
	estimatedCost: z.string().optional(),
	teamStructure: z
		.array(
			z.object({
				role: z.string(),
				count: z.number(),
			}),
		)
		.optional(),
	risks: z
		.array(
			z.object({
				description: z.string(),
				mitigation: z.string(),
			}),
		)
		.optional(),
});

export type ProjectProposal = z.infer<typeof ProjectProposalSchema>;
