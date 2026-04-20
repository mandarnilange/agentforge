import { z } from "zod/v4";

const RunbookStepSchema = z
	.object({
		order: z.number().int().positive(),
		title: z.string(),
		command: z.string().optional(),
		rollbackOnFailure: z.boolean().optional(),
	})
	.passthrough();

export const DeploymentRunbookSchema = z.object({
	title: z.string(),
	steps: z.array(RunbookStepSchema).min(1),
	rollbackProcedure: z.string().optional(),
});

export type DeploymentRunbook = z.infer<typeof DeploymentRunbookSchema>;
