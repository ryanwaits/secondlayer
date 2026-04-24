"use client";

import { SessionCodeBlock } from "./session-code-block";

export function SignedTestFixtureCard({
	subscription,
	body,
	headers,
	curl,
}: {
	subscription: { name: string; target: string; url: string };
	body: string;
	headers: Record<string, string>;
	curl: string;
}) {
	return (
		<div className="tool-card">
			<div className="tool-card-header">Signed test fixture</div>
			<div className="tool-status-row">
				<div className="tool-action-detail">
					<span className="tool-status-name">{subscription.name}</span>
					<span className="tool-action-reason">
						{subscription.target} · {subscription.url}
					</span>
					<span className="tool-action-reason">
						Generated only. Nothing was posted.
					</span>
				</div>
			</div>
			<SessionCodeBlock code={body} lang="json" />
			<SessionCodeBlock code={JSON.stringify(headers, null, 2)} lang="json" />
			<SessionCodeBlock code={curl} lang="bash" />
		</div>
	);
}
