import { afterEach, describe, expect, it } from "vitest";
import {
	clearSecretsForTest,
	listRegisteredSecrets,
	maskSecrets,
	maskSecretsDeep,
	registerSecret,
} from "../../../src/adapters/secrets/secret-registry.js";

describe("secret-registry", () => {
	afterEach(() => {
		clearSecretsForTest();
	});

	it("registers and lists secrets", () => {
		registerSecret("sk-ant-abcdef");
		registerSecret("postgres://alice:pw1234@db/orders");
		expect(listRegisteredSecrets()).toEqual(
			expect.arrayContaining([
				"sk-ant-abcdef",
				"postgres://alice:pw1234@db/orders",
			]),
		);
	});

	it("ignores empty / null / short values", () => {
		registerSecret(undefined);
		registerSecret(null);
		registerSecret("");
		registerSecret("xy"); // too short
		expect(listRegisteredSecrets()).toHaveLength(0);
	});

	it("masks registered secrets in a string", () => {
		registerSecret("sk-ant-abcdef");
		expect(maskSecrets("Authorization: Bearer sk-ant-abcdef and more")).toBe(
			"Authorization: Bearer *** and more",
		);
	});

	it("masks multiple secrets at once", () => {
		registerSecret("sk-ant-abcdef");
		registerSecret("password1234");
		const log = "key=sk-ant-abcdef pw=password1234 user=alice";
		expect(maskSecrets(log)).toBe("key=*** pw=*** user=alice");
	});

	it("returns the input unchanged when no secrets registered", () => {
		expect(maskSecrets("hello world")).toBe("hello world");
	});

	it("handles special regex chars in secret values safely", () => {
		registerSecret("abc.{$|");
		expect(maskSecrets("[abc.{$|]")).toBe("[***]");
	});

	it("maskSecretsDeep walks nested objects and arrays", () => {
		registerSecret("supersecret-123");
		const obj = {
			header: "Bearer supersecret-123",
			nested: {
				items: ["safe", "supersecret-123 in list"],
			},
			meta: 42,
		};
		const out = maskSecretsDeep(obj);
		expect(out.header).toBe("Bearer ***");
		expect(out.nested.items[1]).toBe("*** in list");
		expect(out.nested.items[0]).toBe("safe");
		expect(out.meta).toBe(42);
	});
});
