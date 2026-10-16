import type { Metadata } from "next";
import { Suspense } from "react";
import { CliLogin } from "./cli-login";

export const metadata: Metadata = {
	title: "Approve sl · secondlayer",
	robots: { index: false, follow: false },
};

export default function CliLoginPage() {
	return (
		<Suspense>
			<CliLogin />
		</Suspense>
	);
}
