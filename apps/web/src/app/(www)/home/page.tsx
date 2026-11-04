import type { Metadata } from "next";
import { HomeView, metadata as home } from "../page";

/** The marketing home for a signed-in visitor: `/` sends them to their
 *  Overview. Same page, not indexed; search engines know it as `/`. */
export const metadata: Metadata = {
	...home,
	robots: { index: false, follow: true },
};

export default function SignedInHome() {
	return <HomeView />;
}
