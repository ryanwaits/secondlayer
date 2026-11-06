import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type * as AuthModule from "./auth";

mock.module("next/navigation", () => ({
	usePathname: () => "/account",
	useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { AuthProvider, AuthSeed, authSnapshot, useAuth } = await import(
	"./auth"
);

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
});

describe("AuthSeed", () => {
	test("the server render never writes the shared module state", () => {
		renderToStaticMarkup(tree(account));
		expect(authSnapshot().account).toBeNull();
		expect(authSnapshot().loading).toBe(true);
	});

	test("the browser starts signed in, not loading, from the server's account", () => {
		globalThis.window = {} as Window & typeof globalThis;
		renderToStaticMarkup(tree(account));
		expect(authSnapshot()).toEqual({ account, loading: false });
	});

	test("an unseeded page keeps waiting for the browser's own read", () => {
		globalThis.window = {} as Window & typeof globalThis;
		const before = authSnapshot();
		renderToStaticMarkup(tree(null));
		expect(authSnapshot()).toBe(before);
	});
});

describe("a seed that streams in after the provider mounted", () => {
	// Each case starts from a fresh module: the auth store is shared state.
	const fresh = async (): Promise<typeof AuthModule> => {
		globalThis.window = {} as Window & typeof globalThis;
		return import(`./auth?case=${Math.random()}`);
	};

	test("holds the /api/auth/me read back until the seed lands, then needs none", async () => {
		const auth = await fresh();
		expect(auth.nextAuthRead()).toBe("ask");
		renderToStaticMarkup(<auth.AuthSeedPending />);
		expect(auth.nextAuthRead()).toBe("wait");
		// The streamed account arrives, then its effect ends the hold-back.
		renderToStaticMarkup(<auth.AuthSeed account={account} />);
		auth.endSeeding();
		expect(auth.nextAuthRead()).toBe("known");
		expect(auth.authSnapshot().account).toBe(account);
	});

	test("a signed-out or stale seed hands the read back to the provider", async () => {
		const auth = await fresh();
		renderToStaticMarkup(<auth.AuthSeedPending />);
		renderToStaticMarkup(<auth.AuthSeed account={null} />);
		auth.endSeeding();
		expect(auth.nextAuthRead()).toBe("ask");
	});

	test("nothing is held back when the account is already known", async () => {
		const auth = await fresh();
		renderToStaticMarkup(<auth.AuthSeed account={account} />);
		renderToStaticMarkup(<auth.AuthSeedPending />);
		expect(auth.nextAuthRead()).toBe("known");
	});
});
