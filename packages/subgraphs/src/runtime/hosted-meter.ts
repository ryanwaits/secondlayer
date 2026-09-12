export type HostedMeterHooks = {
	onBlocksProcessed?: (
		accountId: string,
		blocks: number,
		subgraphName: string,
	) => Promise<boolean>;
	onDeliveryAttempt?: (
		accountId: string,
		subscriptionId: string,
	) => Promise<boolean>;
};

let hooks: HostedMeterHooks = {};

export function setHostedMeterHooks(next: HostedMeterHooks): void {
	hooks = next;
}

export function resetHostedMeterHooks(): void {
	hooks = {};
}

export async function meterBlocksProcessed(
	accountId: string | null | undefined,
	blocks: number,
	subgraphName: string,
): Promise<boolean> {
	if (!accountId || blocks <= 0) return true;
	if (!hooks.onBlocksProcessed) return true;
	return hooks.onBlocksProcessed(accountId, blocks, subgraphName);
}

export async function meterDeliveryAttempt(
	accountId: string | null | undefined,
	subscriptionId: string,
): Promise<boolean> {
	if (!accountId) return true;
	if (!hooks.onDeliveryAttempt) return true;
	return hooks.onDeliveryAttempt(accountId, subscriptionId);
}
