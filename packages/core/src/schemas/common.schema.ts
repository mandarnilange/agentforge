import { z } from "zod/v4";

export const UserStorySchema = z.object({
	id: z.string(),
	title: z.string(),
	asA: z.string(),
	iWant: z.string(),
	soThat: z.string(),
	acceptanceCriteria: z.array(z.string()).min(1),
	priority: z.enum(["must-have", "should-have", "could-have", "wont-have"]),
	dependencies: z.array(z.string()).optional(),
});

export const EpicSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	userStories: z.array(UserStorySchema).min(1),
});

export type UserStory = z.infer<typeof UserStorySchema>;
export type Epic = z.infer<typeof EpicSchema>;
