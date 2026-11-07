import { describe, expect, test } from "bun:test";
import {
	INITIAL_KEY_STATE,
	type KeyEvent,
	type KeyState,
	expiryDelay,
	isLive,
	nextKeyState,
} from "./docs-key-state";

const run = (events: KeyEvent[], from: KeyState = INITIAL_KEY_STATE) =>
	events.reduce(nextKeyState, from);

const reader = (owner: string) => run([{ type: "activate", owner }]);
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const mintedFor = (state: KeyState, key = "sk-sl_abc1234") => {
	const minting = nextKeyState(state, { type: "mint" });
	if (minting.key.kind !== "minting") throw new Error("not minting");
	return {
		minting,
		epoch: minting.key.epoch,
		event: {
			type: "minted",
			epoch: minting.key.epoch,
			key,
			expiresAt: FUTURE,
		} as const,
	};
};

describe("minting", () => {
	test("a mint that resolves in its own epoch becomes the held key, hidden", () => {
		const { minting, event } = mintedFor(reader("anon"));
		const state = nextKeyState(minting, event);
		expect(state.key).toEqual({
			kind: "held",
			key: "sk-sl_abc1234",
			expiresAt: FUTURE,
			owner: "anon",
			revealed: false,
		});
	});

	test("a mint resolving after the reader changed is dropped", () => {
		const { minting, event } = mintedFor(reader("anon"));
		const signedIn = nextKeyState(minting, {
			type: "activate",
			owner: "acct-1",
		});
		const after = nextKeyState(signedIn, event);
		expect(after).toBe(signedIn);
		expect(after.key.kind).toBe("none");
	});

	test("a mint resolving after the key was forgotten is dropped", () => {
		const { minting, event } = mintedFor(reader("acct-1"));
		const forgotten = nextKeyState(minting, { type: "forget" });
		expect(nextKeyState(forgotten, event).key.kind).toBe("none");
	});

	test("an old mint cannot land on a newer mint's wait", () => {
		const first = mintedFor(reader("anon"));
		const switched = nextKeyState(first.minting, {
			type: "activate",
			owner: "acct-1",
		});
		const second = mintedFor(switched);
		expect(second.epoch).not.toBe(first.epoch);
		const stale = nextKeyState(second.minting, first.event);
		expect(stale.key.kind).toBe("minting");
		expect(nextKeyState(stale, second.event).key.kind).toBe("held");
	});

	test("re-activating the same reader keeps a mint in flight", () => {
		const { minting, event } = mintedFor(reader("anon"));
		const again = nextKeyState(minting, { type: "activate", owner: "anon" });
		expect(again.key.kind).toBe("minting");
		expect(nextKeyState(again, event).key.kind).toBe("held");
	});

	test("a second mint while one is running, or while a key is held, does nothing", () => {
		const { minting, event } = mintedFor(reader("anon"));
		expect(nextKeyState(minting, { type: "mint" })).toBe(minting);
		const held = nextKeyState(minting, event);
		expect(nextKeyState(held, { type: "mint" })).toBe(held);
	});

	test("a mint before any reader is known does nothing", () => {
		expect(nextKeyState(INITIAL_KEY_STATE, { type: "mint" })).toBe(
			INITIAL_KEY_STATE,
		);
	});

	test("a failed mint goes back to where it started", () => {
		const fresh = mintedFor(reader("anon"));
		expect(
			nextKeyState(fresh.minting, { type: "mintFailed", epoch: fresh.epoch })
				.key,
		).toEqual({ kind: "none" });

		const expired = run([{ type: "expire" }], reader("anon"));
		const again = mintedFor(expired);
		expect(
			nextKeyState(again.minting, { type: "mintFailed", epoch: again.epoch })
				.key,
		).toEqual({ kind: "expired" });
	});

	test("a stale failure does not disturb the current mint", () => {
		const first = mintedFor(reader("anon"));
		const switched = nextKeyState(first.minting, {
			type: "activate",
			owner: "acct-1",
		});
		const second = mintedFor(switched);
		expect(
			nextKeyState(second.minting, { type: "mintFailed", epoch: first.epoch }),
		).toBe(second.minting);
	});
});

describe("the daily limit", () => {
	const limited = () => {
		const { minting, epoch } = mintedFor(reader("anon"));
		return nextKeyState(minting, {
			type: "mintLimited",
			epoch,
			text: "One docs key a day without an account",
		});
	};

	test("a 429 for a signed-out reader shows the note", () => {
		expect(limited().key).toEqual({
			kind: "limited",
			text: "One docs key a day without an account",
		});
	});

	test("signing in leaves the limit and the next mint holds a key", () => {
		const signedIn = nextKeyState(limited(), {
			type: "activate",
			owner: "acct-1",
		});
		expect(signedIn.key.kind).toBe("none");
		const { minting, event } = mintedFor(signedIn);
		const held = nextKeyState(minting, event);
		expect(held.key).toMatchObject({ kind: "held", owner: "acct-1" });
	});

	test("forgetting or a stale expiry does not clear the note", () => {
		const state = limited();
		expect(nextKeyState(state, { type: "forget" }).key.kind).toBe("limited");
		expect(nextKeyState(state, { type: "expire" })).toBe(state);
	});
});

describe("expiry", () => {
	const held = () => {
		const { minting, event } = mintedFor(reader("anon"));
		return nextKeyState(minting, event);
	};

	test("a held key that expires becomes expired", () => {
		expect(nextKeyState(held(), { type: "expire" }).key).toEqual({
			kind: "expired",
		});
	});

	test("an expired key can be replaced by a new mint", () => {
		const expired = nextKeyState(held(), { type: "expire" });
		const { minting, event } = mintedFor(expired);
		expect(nextKeyState(minting, event).key.kind).toBe("held");
	});

	test("the expiry timer fires after the time left, never negative", () => {
		const now = Date.parse("2026-11-07T12:00:00Z");
		expect(expiryDelay("2026-11-07T13:00:00Z", now)).toBe(3_600_000);
		expect(expiryDelay("2026-11-07T11:00:00Z", now)).toBe(0);
	});

	test("a held key is live until its expiry", () => {
		const state = held();
		expect(isLive(state)).toBe(true);
		expect(isLive(state, Date.parse(FUTURE) + 1)).toBe(false);
		expect(isLive(INITIAL_KEY_STATE)).toBe(false);
	});

	test("an expiry during a mint leaves the mint running", () => {
		const { minting } = mintedFor(reader("anon"));
		expect(nextKeyState(minting, { type: "expire" })).toBe(minting);
	});
});

describe("holding and the reader", () => {
	test("a stored key for this reader is adopted, hidden", () => {
		const state = nextKeyState(reader("acct-1"), {
			type: "adopt",
			key: "sk-sl_stored",
			expiresAt: FUTURE,
			owner: "acct-1",
		});
		expect(state.key).toMatchObject({ kind: "held", revealed: false });
	});

	test("Show then Hide flips the key and nothing else", () => {
		const { minting, event } = mintedFor(reader("anon"));
		const held = nextKeyState(minting, event);
		const shown = nextKeyState(held, { type: "toggleReveal" });
		expect(shown.key).toMatchObject({ revealed: true });
		expect(nextKeyState(shown, { type: "toggleReveal" }).key).toMatchObject({
			revealed: false,
		});
		expect(nextKeyState(INITIAL_KEY_STATE, { type: "toggleReveal" })).toBe(
			INITIAL_KEY_STATE,
		);
	});

	test("a different reader drops the held key and closes the panel", () => {
		const { minting, event } = mintedFor(reader("anon"));
		const held = nextKeyState(minting, event);
		const open = nextKeyState(held, { type: "panelShow", mode: "about" });
		const next = nextKeyState(open, { type: "activate", owner: "acct-1" });
		expect(next.owner).toBe("acct-1");
		expect(next.key.kind).toBe("none");
		expect(next.panel.mode).toBe("closed");
	});

	test("the first reader does not bump the epoch", () => {
		expect(reader("anon").epoch).toBe(0);
	});
});

describe("the panel", () => {
	test("opening shows the mode and clears an old error", () => {
		const failed = run(
			[
				{ type: "panelShow", mode: "lasting" },
				{ type: "sendStart" },
				{ type: "sendFailed", error: "Couldn't send the link." },
			],
			reader("anon"),
		);
		expect(failed.panel).toMatchObject({
			mode: "lasting",
			sending: false,
			error: "Couldn't send the link.",
		});
		expect(
			nextKeyState(failed, { type: "panelShow", mode: "about" }).panel,
		).toMatchObject({ mode: "about", error: null });
	});

	test("sending cannot start twice", () => {
		const sending = nextKeyState(reader("anon"), { type: "sendStart" });
		expect(sending.panel.sending).toBe(true);
		expect(nextKeyState(sending, { type: "sendStart" })).toBe(sending);
		expect(nextKeyState(sending, { type: "sendDone" }).panel.sending).toBe(
			false,
		);
	});

	test("closing records when, so the chip click that dismissed it cannot reopen it", () => {
		const open = nextKeyState(reader("anon"), {
			type: "panelShow",
			mode: "about",
		});
		expect(
			nextKeyState(open, { type: "panelClosed", at: 1234 }).panel,
		).toMatchObject({
			mode: "closed",
			closedAt: 1234,
		});
	});
});
