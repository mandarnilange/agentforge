import { z } from "zod/v4";

const AlertSchema = z
	.object({
		name: z.string(),
		condition: z.string(),
		severity: z.enum(["critical", "high", "medium", "low"]),
		channel: z.string().optional(),
	})
	.passthrough();

export const MonitoringConfigSchema = z.object({
	platform: z.string(),
	alerts: z.array(AlertSchema),
	dashboards: z.array(z.record(z.string(), z.unknown())),
	slos: z.array(z.record(z.string(), z.unknown())),
});

export type MonitoringConfig = z.infer<typeof MonitoringConfigSchema>;
