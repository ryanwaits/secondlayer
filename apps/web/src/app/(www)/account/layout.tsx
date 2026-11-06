import {
	AccountSeeds,
	AccountSession,
} from "@/components/account/account-session";
import { requestDeadline } from "@/lib/server/head-start";
import { warmHighlighter } from "@/lib/server/warm-instance";
import { after } from "next/server";

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
	// The highlighter loads once the response is out, so no first request waits
	// on it; the account pages that render code find it warm afterwards.
	after(warmHighlighter);
	return (
		<>
			<AccountSeeds />
			<AccountSession>{children}</AccountSession>
		</>
	);
}
