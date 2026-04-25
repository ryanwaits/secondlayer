import { describe, expect, it } from "bun:test";
import {
	buildSubscriptionAuthConfig,
	resolveSubscriptionClientConfig,
} from "../src/commands/create.ts";

const resolvedTenant = {
	apiUrl: "https://tenant.secondlayer.tools",
	ephemeralKey: "ephemeral-service-key",
	fromEnv: false,
};

describe("create subscription tenant resolution", () => {
	it("builds bearer auth config from --auth-token", () => {
		expect(buildSubscriptionAuthConfig(" tr_secret_abc ")).toEqual({
			authType: "bearer",
			token: "tr_secret_abc",
		});
		expect(buildSubscriptionAuthConfig()).toBeUndefined();
		expect(() => buildSubscriptionAuthConfig("   ")).toThrow(
			"--auth-token must not be empty",
		);
	});

	it("uses explicit flags without tenant resolution", () => {
		expect(
			resolveSubscriptionClientConfig(
				{
					baseUrl: "https://override.example",
					serviceKey: "override-key",
				},
				{},
			),
		).toEqual({
			needsTenantResolution: false,
			baseUrl: "https://override.example",
			apiKey: "override-key",
		});
	});

	it("uses env-var bypass without tenant resolution", () => {
		expect(
			resolveSubscriptionClientConfig(
				{},
				{
					SL_API_URL: "http://localhost:3800",
					SL_SERVICE_KEY: "local-key",
				},
			),
		).toEqual({
			needsTenantResolution: false,
			baseUrl: "http://localhost:3800",
			apiKey: "local-key",
		});
	});

	it("requests active project resolution when no credentials are available", () => {
		expect(resolveSubscriptionClientConfig({}, {})).toEqual({
			needsTenantResolution: true,
		});
	});

	it("fills missing values from resolved tenant credentials", () => {
		expect(
			resolveSubscriptionClientConfig(
				{ serviceKey: "manual-key" },
				{},
				resolvedTenant,
			),
		).toEqual({
			needsTenantResolution: false,
			baseUrl: "https://tenant.secondlayer.tools",
			apiKey: "manual-key",
		});

		expect(
			resolveSubscriptionClientConfig(
				{ baseUrl: "https://manual.example" },
				{},
				resolvedTenant,
			),
		).toEqual({
			needsTenantResolution: false,
			baseUrl: "https://manual.example",
			apiKey: "ephemeral-service-key",
		});
	});
});
