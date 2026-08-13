export const OBSERVER_MODES = ["indexer", "signer-shared"] as const;
export type ObserverMode = (typeof OBSERVER_MODES)[number];

export const RECOVERY_SOURCES = ["journal", "archive"] as const;
export type RecoverySource = (typeof RECOVERY_SOURCES)[number];

export type ObserverStanzaInput = {
	mode: ObserverMode;
	endpoint: string;
	network: "mainnet" | "testnet" | "devnet";
	recovery?: RecoverySource;
};

export class UnsupportedObserverError extends Error {
	readonly name = "UnsupportedObserverError";
}

export function parseObserverMode(value: string): ObserverMode {
	const mode = value.trim().toLowerCase();
	if ((OBSERVER_MODES as readonly string[]).includes(mode)) {
		return mode as ObserverMode;
	}
	throw new UnsupportedObserverError(
		`observer mode must be indexer or signer-shared (got ${value})`,
	);
}

export function parseRecoverySource(value: string): RecoverySource {
	const source = value.trim().toLowerCase();
	if ((RECOVERY_SOURCES as readonly string[]).includes(source)) {
		return source as RecoverySource;
	}
	throw new UnsupportedObserverError(
		`recovery source must be journal or archive (got ${value})`,
	);
}

/** Stacks observer config accepts only host:port — no scheme, no unix socket. */
export function parseObserverEndpoint(value: string): string {
	const trimmed = value.trim();
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("unix:")) {
		throw new UnsupportedObserverError(
			`observer endpoint must be host:port, not a URL (${value})`,
		);
	}
	const match = trimmed.match(/^([a-zA-Z0-9._-]+):(\d+)$/);
	if (!match) {
		throw new UnsupportedObserverError(
			`observer endpoint must be host:port (got ${value})`,
		);
	}
	const port = Number(match[2]);
	if (port < 1 || port > 65535) {
		throw new UnsupportedObserverError(`observer port out of range (${port})`);
	}
	return trimmed;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function validateObserverStanza(input: ObserverStanzaInput): {
	endpoint: string;
} {
	const endpoint = parseObserverEndpoint(input.endpoint);
	const host = endpoint.slice(0, endpoint.lastIndexOf(":"));
	if (input.network !== "devnet" && LOOPBACK_HOSTS.has(host.toLowerCase())) {
		throw new UnsupportedObserverError(
			`loopback observer endpoint is not container-visible on ${input.network}; use a docker DNS name such as indexer:3700`,
		);
	}
	if (input.mode === "signer-shared" && !input.recovery) {
		throw new UnsupportedObserverError(
			"signer-shared mode requires --recovery journal or --recovery archive",
		);
	}
	return { endpoint };
}

/**
 * Stacks node [[events_observer]] stanza.
 *
 * Pure indexer: retry until delivered (completeness). Signer-shared: skip
 * retries so a stuck indexer cannot starve the signer.
 */
export function renderObserverStanza(input: ObserverStanzaInput): string {
	const { endpoint } = validateObserverStanza(input);
	const indexer = input.mode === "indexer";
	const timeoutMs = indexer ? 2000 : 500;
	const disableRetries = !indexer;
	const comment = indexer
		? "# Pure indexer: retry delivery. A slow observer can stall the node."
		: "# Signer-shared: do not retry. Missed blocks refill from the journal/archive.";
	return [
		comment,
		"[[events_observer]]",
		`endpoint = "${endpoint}"`,
		'events_keys = ["*"]',
		`timeout_ms = ${timeoutMs}`,
		`disable_retries = ${disableRetries}`,
		"",
	].join("\n");
}

export function defaultObserverEndpoint(network: string): string {
	if (network === "devnet") return "127.0.0.1:3700";
	return "indexer:3700";
}
