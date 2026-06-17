/**
 * Shared model resolution used by the agent runner, the pipeline executor, and
 * the `exec --dry-run` preview so all three agree on which provider/model runs.
 *
 * Precedence (highest first):
 *   1. CLI `--model` override (modelOverride / providerOverride)
 *   2. the agent definition's spec.model
 *   3. config default (config file / AGENTFORGE_DEFAULT_MODEL / built-in)
 *
 * `--model` is name-first: `--model claude-sonnet-4-6` overrides the model name
 * and pairs it with the *default* provider, while `--model openai/gpt-4o`
 * overrides both. This avoids a name/provider mismatch when an agent declares a
 * non-default provider and the user overrides only the name.
 */

export interface SpecModel {
	provider?: string;
	name?: string;
	maxTokens?: number;
	thinking?: string;
}

export interface ResolvedModel {
	provider: string;
	name: string;
	maxTokens?: number;
	thinking?: string;
}

export interface ResolveModelArgs {
	/** Model name from the `--model` flag (the part after any `provider/`). */
	modelOverride?: string;
	/** Provider from the `--model provider/name` form, if supplied. */
	providerOverride?: string;
	/** The agent definition's spec.model, if any. */
	specModel?: SpecModel;
	/** Default provider (config.llm.provider). */
	defaultProvider: string;
	/** Default model name (config.llm.model, already env/file-resolved). */
	defaultName: string;
	/** Default maxTokens (config.llm.maxTokens). */
	defaultMaxTokens?: number;
}

export function resolveModel(args: ResolveModelArgs): ResolvedModel {
	const spec = args.specModel;

	const name = args.modelOverride ?? spec?.name ?? args.defaultName;

	// providerOverride (explicit `provider/`) wins. A bare `--model name` falls
	// back to the default provider rather than the spec's provider so the
	// overridden name isn't sent to a mismatched provider.
	const provider =
		args.providerOverride ??
		(args.modelOverride
			? args.defaultProvider
			: (spec?.provider ?? args.defaultProvider));

	return {
		provider,
		name,
		maxTokens: spec?.maxTokens ?? args.defaultMaxTokens,
		thinking: spec?.thinking,
	};
}

/**
 * Parse a `--model` flag value. Supports an optional `provider/name` prefix:
 *   "claude-sonnet-4-6"   -> { name: "claude-sonnet-4-6" }
 *   "openai/gpt-4o"       -> { provider: "openai", name: "gpt-4o" }
 * A malformed value with an empty side (e.g. "/x" or "x/") is treated as a bare
 * name so the input is never silently dropped.
 */
export function parseModelFlag(input: string): {
	provider?: string;
	name: string;
} {
	const idx = input.indexOf("/");
	if (idx === -1) return { name: input };
	const provider = input.slice(0, idx).trim();
	const name = input.slice(idx + 1).trim();
	if (!provider || !name) return { name: input };
	return { provider, name };
}
