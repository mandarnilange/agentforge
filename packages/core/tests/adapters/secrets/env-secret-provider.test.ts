import { afterEach, describe, expect, it } from "vitest";
import { EnvSecretProvider } from "../../../src/adapters/secrets/env-secret-provider.js";
import {
	clearSecretsForTest,
	listRegisteredSecrets,
} from "../../../src/adapters/secrets/secret-registry.js";

describe("EnvSecretProvider", () => {
	afterEach(() => {
		clearSecretsForTest();
	});

	it("resolves secret by env var name", async () => {
		const env = { API_TOKEN: "tok-1234567890" };
		const provider = new EnvSecretProvider({ env });
		const value = await provider.resolve({ name: "API_TOKEN" });
		expect(value).toBe("tok-1234567890");
	});

	it("returns undefined when the secret is missing", async () => {
		const provider = new EnvSecretProvider({ env: {} });
		expect(await provider.resolve({ name: "MISSING" })).toBeUndefined();
	});

	it("uses path override when provided", async () => {
		const env = { CUSTOM_ENV_KEY: "resolved-val-999" };
		const provider = new EnvSecretProvider({ env });
		const value = await provider.resolve({
			name: "FRIENDLY_NAME",
			path: "CUSTOM_ENV_KEY",
		});
		expect(value).toBe("resolved-val-999");
	});

	it("registers resolved secrets for masking", async () => {
		const env = { TOKEN: "abc-def-xyz-12345" };
		const provider = new EnvSecretProvider({ env });
		await provider.resolve({ name: "TOKEN" });
		expect(listRegisteredSecrets()).toContain("abc-def-xyz-12345");
	});

	it("has providerId 'env'", () => {
		expect(new EnvSecretProvider().providerId).toBe("env");
	});
});
