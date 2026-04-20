import { z } from "zod/v4";

const MigrationSchema = z
	.object({
		version: z.string(),
		description: z.string(),
		up: z.string(),
		down: z.string().optional(),
	})
	.passthrough();

export const MigrationsSchema = z.object({
	migrations: z.array(MigrationSchema).min(1),
});

export type Migrations = z.infer<typeof MigrationsSchema>;
