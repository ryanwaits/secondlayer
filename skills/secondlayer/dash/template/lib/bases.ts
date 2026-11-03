// Network → base URL + credential. Shared by the proxy (api/sl) and probe.ts.
// Env is read on every call, never at import, so a deploy picks up new env
// and tests can set it.
//
// SL_DASH_BASE_MAINNET overrides the hosted API root (tests only); testnet
// always sits at `<mainnet>/testnet`.

export const NETWORKS = ["mainnet", "testnet", "devnet"] as const;
export type Network = (typeof NETWORKS)[number];

export interface Base {
	url: string;
	/** Bearer credential, or null where reads are open. */
	token: string | null;
}

export function isNetwork(value: string): value is Network {
	return (NETWORKS as readonly string[]).includes(value);
}

export function baseFor(network: Network): Base {
	const env = process.env;
	const hosted = (
		env.SL_DASH_BASE_MAINNET ?? "https://api.secondlayer.tools"
	).replace(/\/+$/, "");
	switch (network) {
		case "mainnet":
			return { url: hosted, token: env.SECONDLAYER_API_KEY || null };
		case "testnet":
			return {
				url: `${hosted}/testnet`,
				token: env.SECONDLAYER_API_KEY || null,
			};
		case "devnet":
			return {
				url: (env.SECONDLAYER_DEVNET_URL ?? "http://127.0.0.1:3800").replace(
					/\/+$/,
					"",
				),
				// Loopback reads are open; a token is only sent when set.
				token: env.INSTANCE_TOKEN || null,
			};
	}
}
