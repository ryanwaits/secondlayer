import type { Metadata } from "next";
import { UnsubscribeView } from "./unsubscribe-view";

export const metadata: Metadata = {
	title: "Unsubscribe",
	robots: { index: false, follow: false },
};

export default async function UnsubscribeUpdatesPage({
	searchParams,
}: {
	searchParams: Promise<{ t?: string | string[] }>;
}) {
	const { t } = await searchParams;
	return <UnsubscribeView token={typeof t === "string" ? t : undefined} />;
}
