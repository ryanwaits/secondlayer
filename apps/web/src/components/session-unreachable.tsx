"use client";

import { useAuth } from "@/lib/auth";
import { useState } from "react";

/** The session couldn't be read, which isn't the same as signed out: pages
 *  that would send a signed-out visitor to /signin show this and retry. */
export function SessionUnreachable() {
	const { refresh } = useAuth();
	const [retrying, setRetrying] = useState(false);
	return (
		<div className="login-page">
			<div className="login-card">
				<span className="login-eyebrow">Account</span>
				<h1 className="login-title">Can't reach Secondlayer</h1>
				<p className="login-disclaimer">
					We couldn't check your session, so nothing was signed out. Check your
					connection and try again.
				</p>
				<button
					type="button"
					className="login-submit"
					disabled={retrying}
					onClick={async () => {
						setRetrying(true);
						await refresh();
						setRetrying(false);
					}}
				>
					{retrying ? "Retrying..." : "Retry"}
				</button>
			</div>
		</div>
	);
}
