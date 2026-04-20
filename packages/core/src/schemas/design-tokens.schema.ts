import { z } from "zod/v4";

const ColorTokenSchema = z.object({
	name: z.string(),
	value: z.string(),
	usage: z.string().optional(),
});

const TypographyTokenSchema = z.object({
	name: z.string(),
	fontFamily: z.string(),
	fontSize: z.string(),
	fontWeight: z.union([z.string(), z.number()]),
	lineHeight: z.string().optional(),
});

const SpacingTokenSchema = z.object({
	name: z.string(),
	value: z.string(),
});

export const DesignTokensSchema = z.object({
	colors: z.array(ColorTokenSchema).optional(),
	typography: z.array(TypographyTokenSchema).optional(),
	spacing: z.array(SpacingTokenSchema).optional(),
	borderRadius: z
		.array(z.object({ name: z.string(), value: z.string() }))
		.optional(),
	shadows: z
		.array(z.object({ name: z.string(), value: z.string() }))
		.optional(),
	breakpoints: z
		.array(z.object({ name: z.string(), value: z.string() }))
		.optional(),
});

export type DesignTokens = z.infer<typeof DesignTokensSchema>;
