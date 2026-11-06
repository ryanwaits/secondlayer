import {
	AccountSeeds,
	AccountSession,
} from "@/components/account/account-session";
import { StreamedReset } from "@/components/motion/stream-marker";
import { AuthSeedPending } from "@/lib/auth";
import { InsightsPending } from "@/lib/insights-store";
import { requestDeadline } from "@/lib/server/head-start";

// Next to the API (Hetzner HEL/fsn1), and per request: the HTML carries one
// account's data, so it is never prerendered or shared.
export const preferredRegion = "fra1";
export const dynamic = "force-dynamic";

/** The seeds, the frame and the page render side by side, each bounded by one
 *  shared head start: the first byte waits for them only that long, then the
 *  frame and the page's skeleton go out and the data streams in. */
export default function AccountLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	requestDeadline();
	return (
		<>
			<AuthSeedPending />
			<InsightsPending />
			<StreamedReset />
			<AccountSeeds />
			<AccountSession>{children}</AccountSession>
		</>
	);
}
