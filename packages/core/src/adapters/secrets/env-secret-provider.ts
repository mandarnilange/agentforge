/**
 * EnvSecretProvider — resolves secrets from process.env.
 *
 * This is the default, zero-config provider used by `agentforge-core`. A
 * SecretRef's `name` maps directly to an environment variable name. Every
 * resolved value is registered with the global secret registry so that
 * subsequent log output masks it.
 */

import type {
	ISecretProvider,
	SecretRef,
} from "../../domain/ports/secret-provider.port.js";
import { registerSecret } from "./secret-registry.js";

export interface EnvSecretProviderOptions {
	/**
	 * Backing map — defaults to `process.env`. Overridable for tests so we
	 * never mutate the real environment.
	 */
	readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export class EnvSecretProvider implements ISecretProvider {
	readonly providerId = "env";
	private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;

	constructor(options: EnvSecretProviderOptions = {}) {
		this.env = options.env ?? process.env;
	}

	async resolve(ref: SecretRef): Promise<string | undefined> {
		const key = ref.path ?? ref.name;
		const value = this.env[key];
		if (typeof value === "string" && value.length > 0) {
			registerSecret(value);
			return value;
		}
		return undefined;
	}
}
