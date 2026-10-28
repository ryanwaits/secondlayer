/** Known AI crawler user-agent tokens, matched case-insensitively. */
export const AI_BOTS = [
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	"ClaudeBot",
	"Claude-User",
	"Claude-SearchBot",
	"PerplexityBot",
	"Perplexity-User",
	"Google-Extended",
	"Bingbot",
	"Googlebot",
	"CCBot",
	"Applebot-Extended",
] as const;

/** Regex source for the proxy matcher's user-agent condition. */
export const AI_BOT_PATTERN = AI_BOTS.join("|");

/** Maps a user-agent header to the AI bot's name, or null for anyone else. */
export function aiBot(ua: string | null): string | null {
	if (!ua) return null;
	const lower = ua.toLowerCase();
	return AI_BOTS.find((bot) => lower.includes(bot.toLowerCase())) ?? null;
}
