import { z } from "zod/v4";

const TaskSchema = z.object({
	id: z.string(),
	title: z.string(),
	estimateHours: z.number(),
	assignee: z.string().optional(),
	status: z.string().optional(),
	description: z.string().optional(),
	dependencies: z.array(z.string()).optional(),
});

const StorySchema = z.object({
	id: z.string(),
	title: z.string(),
	epicId: z.string().optional(),
	storyPoints: z.number().optional(),
	tasks: z.array(TaskSchema).min(1),
	priority: z.string().optional(),
	acceptanceCriteria: z.array(z.string()).optional(),
});

const SprintSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	goal: z.string(),
	duration: z.string().optional(),
	stories: z.array(StorySchema).min(1),
	startDate: z.string().optional(),
	endDate: z.string().optional(),
	capacity: z.number().optional(),
	notes: z.string().optional(),
});

export const SprintPlanSchema = z.object({
	projectName: z.string().optional(),
	sprintDuration: z.string().optional(),
	sprints: z.array(SprintSchema).min(1),
	totalEstimateHours: z.number().optional(),
	totalStoryPoints: z.number().optional(),
	assumptions: z.array(z.string()).optional(),
	notes: z.string().optional(),
});

export type SprintPlan = z.infer<typeof SprintPlanSchema>;
