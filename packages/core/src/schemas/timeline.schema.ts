import { z } from "zod/v4";

const MilestoneSchema = z.object({
	name: z.string(),
	date: z.string(),
	deliverables: z.array(z.string()).optional(),
});

const PhaseSchema = z.object({
	name: z.string(),
	startDate: z.string(),
	endDate: z.string(),
	milestones: z.array(MilestoneSchema).optional(),
	dependencies: z.array(z.string()).optional(),
});

export const TimelineSchema = z.object({
	totalDuration: z.string(),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	phases: z.array(PhaseSchema).min(1),
});

export type Timeline = z.infer<typeof TimelineSchema>;
