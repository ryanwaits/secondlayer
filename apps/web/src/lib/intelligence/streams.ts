import type { Delivery, Stream } from "@/lib/types";

export interface FailurePattern {
	count: number;
	statusCode: number;
	sinceDuration: string;
}

export function detectFailurePattern(
	deliveries: Delivery[],
): FailurePattern | null {
	if (deliveries.length < 3) return null;

	const firstCode = deliveries[0].statusCode;
	if (firstCode >= 200 && firstCode < 300) return null;

	let count = 0;
	for (const d of deliveries) {
		if (d.statusCode !== firstCode) break;
		count++;
	}

	if (count < 3) return null;

	const oldest = new Date(deliveries[count - 1].createdAt);
	const newest = new Date(deliveries[0].createdAt);
	const diffMs = newest.getTime() - oldest.getTime();
	const mins = Math.floor(diffMs / 60000);
	const sinceDuration =
		mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

	return { count, statusCode: firstCode, sinceDuration };
}

export interface DeliveryGap {
	gapStart: number;
	gapEnd: number;
	missedBlocks: number;
}

export function detectDeliveryGap(
	stream: Stream,
	deliveries: Delivery[],
): DeliveryGap | null {
	if (stream.status !== "active" || deliveries.length < 2) return null;

	// Sort by block height descending
	const sorted = [...deliveries].sort((a, b) => b.blockHeight - a.blockHeight);

	for (let i = 0; i < sorted.length - 1; i++) {
		const gap = sorted[i].blockHeight - sorted[i + 1].blockHeight;
		if (gap > 10) {
			return {
				gapStart: sorted[i + 1].blockHeight,
				gapEnd: sorted[i].blockHeight,
				missedBlocks: gap - 1,
			};
		}
	}

	return null;
}
