/**
 * Example AgentForge extension — demonstrates how to add custom skill tools
 * that agents can call during execution.
 *
 * To use this extension, add it to your agent YAML:
 *
 *   spec:
 *     extensions:
 *       - extensions/example-skill.ts
 *
 * The file must default-export an ExtensionFactory function.
 * See: docs/pi-coding-agent-extensions.md
 */

import { defineTool } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default (pi: ExtensionAPI) => {
	// Register a custom tool the LLM agent can call
	pi.registerTool(
		defineTool({
			name: "example_hello",
			label: "Example Hello",
			description:
				"A sample tool that returns a greeting. Replace this with your own skill logic.",
			parameters: Type.Object({
				name: Type.String({ description: "Name to greet" }),
			}),
			async execute(_toolCallId, { name }) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Hello, ${name}! This is a custom AgentForge extension tool.`,
						},
					],
				};
			},
		}),
	);

	// You can also subscribe to agent lifecycle events:
	// pi.on("turn_end", (event, ctx) => {
	//   console.log(`Turn completed in ${ctx.cwd}`);
	// });
};
