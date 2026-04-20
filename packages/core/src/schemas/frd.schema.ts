import { z } from "zod/v4";
import { EpicSchema } from "./common.schema.js";

export const FrdSchema = z.object({
	projectName: z.string(),
	version: z.string(),
	epics: z.array(EpicSchema).min(1),
	businessRules: z.array(z.string()),
	assumptions: z.array(z.string()),
	constraints: z.array(z.string()),
	outOfScope: z.array(z.string()),
});

export type FRD = z.infer<typeof FrdSchema>;
