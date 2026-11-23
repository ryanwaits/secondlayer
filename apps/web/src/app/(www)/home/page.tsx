import type { Metadata } from "next";
import { HomeView, metadata as home } from "../page";

export const metadata: Metadata = {
	...home,
	robots: { index: false, follow: true },
};

export default function SignedInHome() {
	return <HomeView />;
}
