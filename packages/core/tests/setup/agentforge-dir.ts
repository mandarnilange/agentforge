import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Default the AgentForge definitions directory to the bundled simple-sdlc
 * template for the whole test run. Many unit tests reference the starter
 * agents (analyst/architect/developer) and their schemas without scaffolding
 * a project of their own. Tests that need an isolated directory still override
 * `process.env.AGENTFORGE_DIR` in their own setup and restore it afterwards.
 *
 * Only set when unset so an explicit AGENTFORGE_DIR from the environment wins.
 */
const here = dirname(fileURLToPath(import.meta.url));
const simpleSdlcTemplate = join(
	here,
	"..",
	"..",
	"src",
	"templates",
	"simple-sdlc",
);

if (!process.env.AGENTFORGE_DIR) {
	process.env.AGENTFORGE_DIR = simpleSdlcTemplate;
}
