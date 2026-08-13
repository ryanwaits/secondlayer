/** Default modules on a standard OSS instance. Idle flags consume no work. */

export const INSTANCE_FEATURE_MANIFEST = {
	rawRest: true,
	rawSse: true,
	index: true,
	subgraphs: true,
	subscriptions: true,
	webhooks: true,
	contractDiscovery: true,
	verification: true,
	protocolDatasets: {
		sbtc: process.env.SBTC_DECODER_ENABLED !== "false",
		pox: process.env.POX4_DECODER_ENABLED !== "false",
		bns: process.env.BNS_DECODER_ENABLED === "true",
	},
	signup: false,
	pricing: false,
	publicDirectory: false,
	unsignedWebhooks: process.env.ALLOW_UNSIGNED_WEBHOOKS === "true",
} as const;

export type InstanceFeatureManifest = typeof INSTANCE_FEATURE_MANIFEST;
