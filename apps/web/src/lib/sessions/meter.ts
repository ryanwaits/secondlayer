/**
 * Fire-and-forget AI eval meter emitter. Posts token counts to the
 * platform API which forwards to Stripe billing meters. Never throws —
 * metering must not interrupt response streaming.
 */

const API_URL = process.env.SL_API_URL || "http://localhost:3800";

export function emitAiEval(sessionToken: string, tokens: number): void {
	if (!Number.isFinite(tokens) || tokens <= 0) return;
	fetch(`${API_URL}/api/accounts/me/meter`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify({ eventName: "ai_evals", value: tokens }),
	}).catch(() => {
		// Swallow — metering errors must never break the user response.
	});
}
