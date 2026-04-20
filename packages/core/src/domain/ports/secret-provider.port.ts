/**
 * ISecretProvider — resolves secrets by reference at runtime.
 *
 * Agents declare which secrets they need (by name). The provider is responsible
 * for resolving each ref into a raw value. Resolved values should be passed to
 * the global secret registry so that downstream log emissions can mask them.
 *
 * Core ships `EnvSecretProvider` (reads from process env). Additional providers
 * (AWS Secrets Manager, GCP Secret Manager, Vault, Azure Key Vault) live in
 * separate optional packages.
 *
 * ZERO external dependencies.
 */

export interface SecretRef {
	/** Logical name used by agents and YAML (e.g. "ANTHROPIC_API_KEY"). */
	readonly name: string;
	/** Provider-specific path or identifier (optional — defaults to `name`). */
	readonly path?: string;
}

export interface ISecretProvider {
	/** Identifier for the provider (e.g. "env", "aws", "gcp", "vault"). */
	readonly providerId: string;

	/**
	 * Resolve a SecretRef to its raw value. Returns undefined when the secret
	 * is not found. Throws only on transport/authentication errors, never on
	 * missing keys.
	 */
	resolve(ref: SecretRef): Promise<string | undefined>;
}
