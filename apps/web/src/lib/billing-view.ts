/**
 * Pure view helpers for the Billing screen: the spend line and its
 * projection, the per-day cost split, the by-unit
 * table. No React, no fetch. Money stays in USD-micros strings until a value
 * is shaped for display or a chart.
 */

/** "$6.21": USD-micros (or dollars as a number of micros) to two decimals. */
export function dollars(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

/** The custom cap box: whole dollars above zero, or `null` (no cap). */
export function parseCapInput(text: string): number | null {
	const trimmed = text.trim();
	if (!/^\d+$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return value > 0 && Number.isSafeInteger(value) ? value : null;
}

/** A cap in cents back to whole dollars for the control, or `null`. */
export function capDollars(monthlyCapCents: number | null): number | null {
	return monthlyCapCents == null ? null : Math.round(monthlyCapCents / 100);
}
