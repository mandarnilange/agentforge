export interface TemplateContext {
	run?: {
		id: string;
		workdir: string;
		agent: string;
		phase: string;
		status: string;
	};
	pipeline?: { id: string; name: string };
	project?: { name: string; repo: string; repoPath: string };
	steps: Record<string, { output?: string; exitCode?: number }>;
	env: Record<string, string>;
	/**
	 * Loop state — present only while executing inside a loop body.
	 * Nested loops overwrite this field; the innermost loop wins.
	 */
	loop?: { iteration: number; maxIterations: number };
}

export function resolveTemplate(
	template: string,
	ctx: TemplateContext,
): string {
	return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
		const parts = path.trim().split(".");
		let current: unknown = ctx;

		for (const part of parts) {
			if (current === null || current === undefined) return "";
			if (typeof current !== "object") return "";
			current = (current as Record<string, unknown>)[part];
		}

		if (current === null || current === undefined) return "";
		return String(current);
	});
}
