import { AccountFrame } from "@/components/account/account-frame";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { CompactSeed } from "@/components/mobile/use-compact";
import { AccountSeedProvider } from "@/lib/account-data";
import { AuthSeed } from "@/lib/auth";
import { logColdStart } from "@/lib/server/cold-start";
import { savedCompact } from "@/lib/server/compact-view";
import { accountRead, accountReads } from "@/lib/server/dashboard-reads";
import { sessionToken } from "@/lib/server/session";
import { Suspense } from "react";

/** What /account sends first: the frame with nothing in it. The page's own
 *  skeletons follow in the same flush, since reading the cookies takes no
 *  network. The phone chrome is here so the header and tab bar never wait. */
export function AccountShell() {
	return (
		<div className="acct-page">
			<MobileShell>
				<main className="acct-main" aria-busy="true" />
			</MobileShell>
		</div>
	);
}

/** The account's balance for the nav chip and the account for `useAuth`.
 *  Renders nothing; it seeds the client stores once the reads land, under its
 *  own boundary so no page waits for them. */
async function AccountSeeds({
	token,
	startedAt,
}: {
	token: string | null;
	startedAt: number;
}) {
	const [seed, account] = token
		? await Promise.all([accountReads(token, ["billing"]), accountRead(token)])
		: [{}, null];
	logColdStart("/account", startedAt);
	return (
		<>
			<AccountSeedProvider seed={seed} />
			<AuthSeed account={account} />
		</>
	);
}

/** Everything under /account that depends on who is asking. The cookie reads
 *  are local, so the frame and the page's skeletons go out at once; the
 *  account reads stream in behind them. A visitor with no session cookie gets
 *  the sign-in card, decided here and not by a flash of skeletons. */
export async function AccountSession({
	children,
}: {
	children: React.ReactNode;
}) {
	const startedAt = performance.now();
	const [token, compact] = await Promise.all([sessionToken(), savedCompact()]);
	return (
		<CompactSeed saved={compact}>
			<Suspense fallback={null}>
				<AccountSeeds token={token} startedAt={startedAt} />
			</Suspense>
			<AccountFrame signedOut={!token}>{children}</AccountFrame>
		</CompactSeed>
	);
}
