/**
 * CI gate (type level): `chain: "bitcoin"` narrows every
 * Streams read/write surface (`events.list`, `events.stream`,
 * `events.subscribe`, `events.consume`, and the top-level `consume`) to
 * `RuneStreamsEvent` and restricts `types` to `RuneEventType` — a Stacks type
 * or a Stacks-only filter under `chain: "bitcoin"` is a compile error, not a
 * silent 400 discovered at request time. Checked by `bun check` (src is
 * included), never bundled nor run.
 *
 * A call that matches no overload is reported on each property that breaks
 * the last (Stacks) overload, so each directive sits above that property.
 */
import { expectTypeOf } from "expect-type";
import type {
	RuneStreamsEvent,
	StreamsBatch,
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

// events.stream
{
	// @ts-expect-error — "ft_transfer" is a Stacks type, not a RuneEventType
	client.events.stream({ chain: "bitcoin", types: ["ft_transfer"] });

	const stream = client.events.stream({
		chain: "bitcoin",
		types: ["rune_transfer"],
	});
	expectTypeOf(stream).toEqualTypeOf<AsyncIterable<RuneStreamsEvent>>();

	// @ts-expect-error — contractId is Stacks-only, not part of the bitcoin branch
	client.events.stream({ chain: "bitcoin", contractId: "SP1.token" });
}

// events.subscribe
client.events.subscribe({
	// @ts-expect-error — "ft_transfer" is a Stacks type, not a RuneEventType
	chain: "bitcoin",
	types: ["ft_transfer"],
	onEvent: () => {},
});

client.events.subscribe({
	chain: "bitcoin",
	types: ["rune_transfer"],
	onEvent: (event) => {
		expectTypeOf(event).toEqualTypeOf<RuneStreamsEvent>();
	},
});

client.events.subscribe({
	filters: { a: { types: ["ft_transfer"] } },
	// @ts-expect-error — filters is Stacks-only, not part of the bitcoin branch
	chain: "bitcoin",
	onEvent: () => {},
});

// events.consume
client.events.consume({
	// @ts-expect-error — "ft_transfer" is a Stacks type, not a RuneEventType
	chain: "bitcoin",
	types: ["ft_transfer"],
	onBatch: () => {},
});

await client.events.consume({
	chain: "bitcoin",
	types: ["rune_transfer"],
	onBatch: (events, ctx) => {
		expectTypeOf(events).toEqualTypeOf<RuneStreamsEvent[]>();
		expectTypeOf(ctx.tip).toEqualTypeOf<StreamsBitcoinTip>();
	},
});

await client.events.consume({
	// @ts-expect-error — filters/on is Stacks-only, not part of the bitcoin branch
	chain: "bitcoin",
	// @ts-expect-error — the Stacks overload rejects "rune_transfer" too
	filters: { a: { types: ["rune_transfer"] } },
	onBatch: () => {},
});

// top-level consume
{
	// @ts-expect-error — "ft_transfer" is a Stacks type, not a RuneEventType
	client.consume({ chain: "bitcoin", types: ["ft_transfer"] });

	const batches = client.consume({
		chain: "bitcoin",
		types: ["rune_transfer"],
	});
	expectTypeOf(batches).toEqualTypeOf<
		AsyncIterableIterator<StreamsBatch<RuneStreamsEvent, StreamsBitcoinTip>>
	>();

	// @ts-expect-error — contractId is Stacks-only, not part of the bitcoin branch
	client.consume({ chain: "bitcoin", contractId: "SP1.token" });
}
