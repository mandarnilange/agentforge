/**
 * IPromptLoader — port for loading system prompts by agent ID.
 * ZERO external dependencies.
 */

export interface IPromptLoader {
	load(agentId: string): Promise<string>;
}
