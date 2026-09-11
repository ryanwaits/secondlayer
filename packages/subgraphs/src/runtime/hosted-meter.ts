export type HostedMeterHooks = {
	onBlocksProcessed?: (accountId: string, blocks: number) => Promise<void>;
	onDeliveryAttempt?: (accountId: string) => Promise<void>;
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
): Promise<void> {
	if (!accountId || blocks <= 0) return;
	await hooks.onBlocksProcessed?.(accountId, blocks);
}

export async function meterDeliveryAttempt(
	accountId: string | null | undefined,
): Promise<void> {
	if (!accountId) return;
	await hooks.onDeliveryAttempt?.(accountId);
}
