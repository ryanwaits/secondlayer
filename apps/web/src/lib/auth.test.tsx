import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
	usePathname: () => "/account",
	useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { accountSnapshot, clearAccountData, refreshKeys } = await import(
	"./account-data"
);
const { AuthProvider, AuthSeed, accountTraits, authSnapshot, useAuth } =
	await import("./auth");

const account = {
	id: "acct_1",
	email: "a@example.com",
} as unknown as Parameters<typeof AuthSeed>[0]["account"];

function Probe() {
	const { loading, account } = useAuth();
	return <p>{loading ? "loading" : (account?.email ?? "signed-out")}</p>;
}

const tree = (seed: typeof account) => (
	<AuthProvider>
		<Probe />
		<AuthSeed account={seed} />
	</AuthProvider>
);

afterEach(() => {
	(globalThis as { window?: unknown }).window = undefined;
	clearAccountData();
});

describe("AuthSeed", () => {
	test("the server render never writes the shared module state", () => {
		renderToStaticMarkup(tree(account));
		expect(authSnapshot().session).toEqual({ kind: "unknown" });
	});

	test("the browser starts signed in, not loading, from the server's account", () => {
		globalThis.window = {} as Window & typeof globalThis;
		renderToStaticMarkup(tree(account));
		expect(authSnapshot().session).toEqual({
			kind: "signedIn",
			account: account as never,
		});
	});

	test("a different account than the tab held drops the old account's data", async () => {
		globalThis.window = {} as Window & typeof globalThis;
		renderToStaticMarkup(tree(account));
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ keys: [{ id: "old-key" }] }))) as never;
		await refreshKeys();
		globalThis.fetch = original;
		expect(accountSnapshot().keys).toHaveLength(1);

		const other = { ...account, id: "acct_2" } as typeof account;
		renderToStaticMarkup(tree(other));
		expect(accountSnapshot().keys).toBeNull();
		expect(authSnapshot().session).toEqual({
			kind: "signedIn",
			account: other as never,
		});
	});

	test("a re-read of the same account keeps its data", async () => {
		globalThis.window = {} as Window & typeof globalThis;
		renderToStaticMarkup(tree({ ...account, id: "acct_3" } as typeof account));
		const original = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ keys: [{ id: "my-key" }] }))) as never;
		await refreshKeys();
		globalThis.fetch = original;

		renderToStaticMarkup(tree({ ...account, id: "acct_3" } as typeof account));
		expect(accountSnapshot().keys).toHaveLength(1);
	});

	test("an unseeded page keeps waiting for the browser's own read", () => {
		globalThis.window = {} as Window & typeof globalThis;
		const before = authSnapshot();
		renderToStaticMarkup(tree(null));
		expect(authSnapshot()).toBe(before);
	});
});

describe("accountTraits", () => {
	const base = {
		id: "acct_1",
		email: "a@example.com",
		displayName: null,
		bio: null,
		avatarUrl: null,
		createdAt: "2026-11-07T00:00:00.000Z",
	};

	test("a first-party account marks its person internal", () => {
		expect(accountTraits({ ...base, internal: true })).toEqual({
			email: "a@example.com",
			$internal_or_test_user: true,
		});
	});

	test("a customer account says so, so a cleared flag clears the person", () => {
		expect(
			accountTraits({ ...base, displayName: "Ada", internal: false }),
		).toEqual({
			email: "a@example.com",
			name: "Ada",
			$internal_or_test_user: false,
		});
	});

	test("a payload without the flag leaves the person's flag alone", () => {
		expect(accountTraits(base)).not.toHaveProperty("$internal_or_test_user");
	});
});
