import type { Metadata } from "next";
import { ClaimFlow } from "./claim-flow";

export const metadata: Metadata = {
	title: "Claim your API key — secondlayer",
	description:
		"Attach an email to a ghost API key. The key and its history survive.",
};

export default async function ClaimPage({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;
	return (
		<div className="claim-page">
			<h1>Claim this API key</h1>
			<p className="claim-lede">
				This key was minted without an account. Attach an email and it becomes
				a real one — the key keeps working, history included.
			</p>
			<ClaimFlow token={token} />
		</div>
	);
}
