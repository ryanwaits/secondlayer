import type { Metadata } from "next";
import { Suspense } from "react";
import { OauthConsent } from "./oauth-consent";

export const metadata: Metadata = {
	title: "Allow an app",
	robots: { index: false, follow: false },
};

export default function OauthConsentPage() {
	return (
		<Suspense>
			<OauthConsent />
		</Suspense>
	);
}
