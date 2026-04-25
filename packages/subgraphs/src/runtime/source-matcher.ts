import type { SubgraphFilter } from "../types.ts";

export interface MatchedTx {
	tx: TxRecord;
	events: EventRecord[];
	/** Source object key — used for handler dispatch */
	sourceName: string;
}

type TxRecord = {
	tx_id: string;
	type: string;
	sender: string;
	status: string;
	contract_id?: string | null;
	function_name?: string | null;
	function_args?: unknown | null;
	raw_result?: string | null;
};

type EventRecord = {
	id: string;
	tx_id: string;
	type: string;
	event_index: number;
	data: unknown;
};

// ── Wildcard matching (shared with v1) ──────────────────────────────

const patternCache = new Map<string, RegExp>();

function matchPattern(value: string, pattern: string): boolean {
	if (!pattern.includes("*")) return value === pattern;
	let re = patternCache.get(pattern);
	if (!re) {
		const regex = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*");
		re = new RegExp(`^${regex}$`);
		patternCache.set(pattern, re);
	}
	return re.test(value);
}

// ── Per-filter-type matchers ────────────────────────────────────────

function matchFilter(
	filter: SubgraphFilter,
	transactions: TxRecord[],
	eventsByTx: Map<string, EventRecord[]>,
): { tx: TxRecord; events: EventRecord[] }[] {
	const results: { tx: TxRecord; events: EventRecord[] }[] = [];

	switch (filter.type) {
		// ── STX events ──
		case "stx_transfer":
		case "stx_mint":
		case "stx_burn":
		case "stx_lock": {
			const eventType = `${filter.type}_event`;
			for (const tx of transactions) {
				const txEvents = eventsByTx.get(tx.tx_id) ?? [];
				const matched = txEvents.filter((e) => e.type === eventType);
				if (matched.length === 0) continue;

				// Apply address filters
				const filtered = matched.filter((e) => {
					const data = e.data as Record<string, unknown> | null;
					if (!data) return false;
					if ("sender" in filter && filter.sender) {
						if (!matchPattern(data.sender as string, filter.sender))
							return false;
					}
					if ("recipient" in filter && filter.recipient) {
						if (!matchPattern(data.recipient as string, filter.recipient))
							return false;
					}
					if ("lockedAddress" in filter && filter.lockedAddress) {
						if (
							!matchPattern(data.locked_address as string, filter.lockedAddress)
						)
							return false;
					}
					// Amount filters
					if ("minAmount" in filter && filter.minAmount !== undefined) {
						const amount = BigInt(
							(data.amount ?? data.locked_amount ?? "0") as string,
						);
						if (amount < filter.minAmount) return false;
					}
					if (
						"maxAmount" in filter &&
						(filter as { maxAmount?: bigint }).maxAmount !== undefined
					) {
						const amount = BigInt((data.amount ?? "0") as string);
						if (amount > (filter as { maxAmount: bigint }).maxAmount)
							return false;
					}
					return true;
				});

				if (filtered.length > 0) {
					results.push({ tx, events: filtered });
				}
			}
			break;
		}

		// ── FT events ──
		case "ft_transfer":
		case "ft_mint":
		case "ft_burn": {
			const eventType = `${filter.type}_event`;
			for (const tx of transactions) {
				const txEvents = eventsByTx.get(tx.tx_id) ?? [];
				const matched = txEvents.filter((e) => {
					if (e.type !== eventType) return false;
					const data = e.data as Record<string, unknown> | null;
					if (!data) return false;

					// Asset identifier filter
					if (filter.assetIdentifier) {
						const assetId = data.asset_identifier as string | undefined;
						if (!assetId || !matchPattern(assetId, filter.assetIdentifier))
							return false;
					}
					// Address filters
					if ("sender" in filter && filter.sender) {
						if (!matchPattern(data.sender as string, filter.sender))
							return false;
					}
					if ("recipient" in filter && filter.recipient) {
						if (!matchPattern(data.recipient as string, filter.recipient))
							return false;
					}
					// Amount filter
					if (filter.minAmount !== undefined) {
						const amount = BigInt((data.amount ?? "0") as string);
						if (amount < filter.minAmount) return false;
					}
					return true;
				});

				if (matched.length > 0) {
					results.push({ tx, events: matched });
				}
			}
			break;
		}

		// ── NFT events ──
		case "nft_transfer":
		case "nft_mint":
		case "nft_burn": {
			const eventType = `${filter.type}_event`;
			for (const tx of transactions) {
				const txEvents = eventsByTx.get(tx.tx_id) ?? [];
				const matched = txEvents.filter((e) => {
					if (e.type !== eventType) return false;
					const data = e.data as Record<string, unknown> | null;
					if (!data) return false;

					if (filter.assetIdentifier) {
						const assetId = data.asset_identifier as string | undefined;
						if (!assetId || !matchPattern(assetId, filter.assetIdentifier))
							return false;
					}
					if ("sender" in filter && filter.sender) {
						if (!matchPattern(data.sender as string, filter.sender))
							return false;
					}
					if ("recipient" in filter && filter.recipient) {
						if (!matchPattern(data.recipient as string, filter.recipient))
							return false;
					}
					return true;
				});

				if (matched.length > 0) {
					results.push({ tx, events: matched });
				}
			}
			break;
		}

		// ── Contract call ──
		case "contract_call": {
			for (const tx of transactions) {
				if (tx.type !== "contract_call") continue;

				// Contract filter
				if (filter.contractId) {
					if (
						!tx.contract_id ||
						!matchPattern(tx.contract_id, filter.contractId)
					)
						continue;
				}
				// Function filter
				if (filter.functionName) {
					if (
						!tx.function_name ||
						!matchPattern(tx.function_name, filter.functionName)
					)
						continue;
				}
				// Caller filter
				if (filter.caller) {
					if (!matchPattern(tx.sender, filter.caller)) continue;
				}

				const txEvents = eventsByTx.get(tx.tx_id) ?? [];
				results.push({ tx, events: txEvents });
			}
			break;
		}

		// ── Contract deploy ──
		case "contract_deploy": {
			for (const tx of transactions) {
				if (tx.type !== "smart_contract") continue;

				if (filter.deployer) {
					if (!matchPattern(tx.sender, filter.deployer)) continue;
				}
				if (filter.contractName) {
					const name = tx.contract_id?.split(".")[1] ?? "";
					if (!matchPattern(name, filter.contractName)) continue;
				}

				const txEvents = eventsByTx.get(tx.tx_id) ?? [];
				results.push({ tx, events: txEvents });
			}
			break;
		}

		// ── Print event ──
		case "print_event": {
			for (const tx of transactions) {
				const txEvents = eventsByTx.get(tx.tx_id) ?? [];
				const matched = txEvents.filter((e) => {
					if (e.type !== "smart_contract_event" && e.type !== "contract_event")
						return false;
					const data = e.data as Record<string, unknown> | null;
					if (!data) return false;
					if (data.topic !== "print") return false;

					// Contract filter
					if (filter.contractId) {
						const contractId = data.contract_identifier as string | undefined;
						if (!contractId || !matchPattern(contractId, filter.contractId))
							return false;
					}
					// Topic filter — check the decoded Clarity value's topic field
					// At this stage data.value is still raw hex; topic filtering happens
					// after decode in the runner. For now, skip topic filtering here.
					// The runner will filter by topic after decoding.
					return true;
				});

				if (matched.length > 0) {
					results.push({ tx, events: matched });
				}
			}
			break;
		}
	}

	return results;
}

/**
 * Match named filters against a block's transactions and events.
 * Returns matches with sourceName = the object key from sources.
 */
export function matchSources(
	sources: Record<string, SubgraphFilter>,
	transactions: TxRecord[],
	events: EventRecord[],
): MatchedTx[] {
	// Index events by txId
	const eventsByTx = new Map<string, EventRecord[]>();
	for (const event of events) {
		const list = eventsByTx.get(event.tx_id) ?? [];
		list.push(event);
		eventsByTx.set(event.tx_id, list);
	}

	const seen = new Set<string>();
	const results: MatchedTx[] = [];

	for (const [sourceName, filter] of Object.entries(sources)) {
		const matches = matchFilter(filter, transactions, eventsByTx);
		for (const match of matches) {
			const dedupeKey = `${match.tx.tx_id}:${sourceName}`;
			if (!seen.has(dedupeKey)) {
				seen.add(dedupeKey);
				results.push({ ...match, sourceName });
			}
		}
	}

	return results;
}
