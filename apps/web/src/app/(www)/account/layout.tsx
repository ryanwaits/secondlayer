import {
	AccountSession,
	AccountShell,
} from "@/components/account/account-session";
import { AuthSeedPending } from "@/lib/auth";
import { InsightsPending } from "@/lib/insights-store";
import { Suspense } from "react";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

/** Nothing here awaits: the frame goes out first and everything that depends
 *  on the session (the cookies, the balance, the account) streams in under
 *  the boundary. Awaiting above it would hold back the first chunk. */
export default function AccountLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<>
			<AuthSeedPending />
			<InsightsPending />
			<Suspense fallback={<AccountShell />}>
				<AccountSession>{children}</AccountSession>
			</Suspense>
		</>
	);
}
