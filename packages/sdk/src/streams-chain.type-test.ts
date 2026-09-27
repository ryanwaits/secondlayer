/**
 * CI gate (type level, plan 059): `chain: "bitcoin"` on `events.list` narrows
 * `types` to `RuneEventType` — a Stacks type there is a compile error, not a
 * silent 400 discovered at request time. Checked by `tsc` (src is included),
 * never bundled nor run.
 */
import { expectTypeOf } from "expect-type";
import type {
	RuneStreamsEvent,
	StreamsBitcoinTip,
	StreamsClient,
} from "./streams/types.ts";

declare const client: StreamsClient;

{
	// @ts-expect-error — "ft_transfer" is a Stacks type, not a RuneEventType
	await client.events.list({ chain: "bitcoin", types: ["ft_transfer"] });

	const page = await client.events.list({
		chain: "bitcoin",
		types: ["rune_transfer"],
	});
	expectTypeOf(page.events).toEqualTypeOf<RuneStreamsEvent[]>();
	expectTypeOf(page.tip).toEqualTypeOf<StreamsBitcoinTip>();

	// @ts-expect-error — contractId is Stacks-only, not part of the bitcoin branch
	await client.events.list({ chain: "bitcoin", contractId: "SP1.token" });
}
