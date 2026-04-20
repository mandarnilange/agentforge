import { z } from "zod/v4";

const AttributeSchema = z
	.object({
		name: z.string(),
		type: z.string(),
		primaryKey: z.boolean().optional(),
		nullable: z.boolean().optional(),
	})
	.passthrough();

const EntitySchema = z
	.object({
		name: z.string(),
		attributes: z.array(AttributeSchema),
	})
	.passthrough();

const RelationshipSchema = z
	.object({
		from: z.string(),
		to: z.string(),
		cardinality: z.string(),
	})
	.passthrough();

export const ErdSchema = z.object({
	entities: z.array(EntitySchema).min(1),
	relationships: z.array(RelationshipSchema),
});

export type Erd = z.infer<typeof ErdSchema>;
