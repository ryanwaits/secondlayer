import type { Metadata } from "next";
import { ConfirmView } from "./confirm-view";

export const metadata: Metadata = {
	title: "Confirm your subscription",
	robots: { index: false, follow: false },
};

export default async function ConfirmUpdatesPage({
	searchParams,
}: {
	searchParams: Promise<{ t?: string | string[] }>;
}) {
	const { t } = await searchParams;
	return <ConfirmView token={typeof t === "string" ? t : undefined} />;
}
