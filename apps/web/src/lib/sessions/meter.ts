/**
 * Fire-and-forget AI eval meter emitter. Posts to the platform API which
 * forwards to Stripe billing meters. Never throws — metering must not
 * interrupt response streaming.
 *
 * Unit semantics: 1 `ai_evals` unit = 1,000 tokens (input + output
 * combined). Caller passes raw token count; we convert here. The API
 * endpoint enforces the same convention with a ceiling.
 */

const API_URL = process.env.SL_API_URL || "http://localhost:3800";
const TOKENS_PER_UNIT = 1000;
const PER_CALL_MAX_UNITS = 50_000;

export function emitAiEval(sessionToken: string, tokens: number): void {
	if (!Number.isFinite(tokens) || tokens <= 0) return;
	const rawUnits = Math.round(tokens / TOKENS_PER_UNIT);
	// Min 1 unit so a 100-token call still bills $0.01 — without this a
	// session of tiny calls would be free.
	const units = Math.min(Math.max(1, rawUnits), PER_CALL_MAX_UNITS);
	fetch(`${API_URL}/api/accounts/me/meter`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${sessionToken}`,
		},
		body: JSON.stringify({ eventName: "ai_evals", value: units }),
	}).catch(() => {
		// Swallow — metering errors must never break the user response.
	});
}
