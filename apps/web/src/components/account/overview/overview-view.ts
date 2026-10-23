import type { HostedStack } from "@/lib/usage";

/** What the hosted stack cell needs to know beyond the stack itself. */
export interface StackContext {
	/** Every webhook is paused, so the stack was put to sleep on purpose. */
	asleep: boolean;
	/** Credits left in USD micros; null until billing has loaded. */
	creditsUsdMicros: string | null;
}

/**
 * True when the stack stopped because the credits ran out, which needs the
 * reader. A stack stopped on purpose (asleep) or with credits left does not.
 */
export function stoppedForCredits(
	stack: HostedStack,
	{ asleep, creditsUsdMicros }: StackContext,
): boolean {
	return (
		stack.state === "stopped" &&
		!asleep &&
		(creditsUsdMicros === null || Number(creditsUsdMicros) <= 0)
	);
}

/** HH:MM in the viewer's clock. */
export function clockTime(at: Date): string {
	return at.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}
