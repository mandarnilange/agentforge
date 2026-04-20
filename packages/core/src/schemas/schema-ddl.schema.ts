import { z } from "zod/v4";

export const SchemaDdlSchema = z.object({
	dialect: z.string(),
	statements: z.array(z.string()).min(1),
});

export type SchemaDdl = z.infer<typeof SchemaDdlSchema>;
