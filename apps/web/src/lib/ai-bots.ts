/**
 * AI crawler tokens as they appear in real user agents. Google-Extended and
 * Applebot-Extended are robots.txt tokens only and never show up in a UA.
 */
export const AI_BOTS = [
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	"ClaudeBot",
	"Claude-User",
	"Claude-SearchBot",
	"PerplexityBot",
	"Perplexity-User",
	"bingbot",
	"Googlebot",
	"CCBot",
	"Applebot",
] as const;

/**
 * Value for the proxy matcher's user-agent condition. Next evaluates it as
 * new RegExp(`^${value}$`), case-sensitively, so it must be wrapped in .*.
 */
export const AI_BOT_UA_MATCHER = `.*(?:${AI_BOTS.join("|")}).*`;

/** Maps a user-agent header (case-insensitive) to the AI bot's name, or null for anyone else. */
export function aiBot(ua: string | null): string | null {
	if (!ua) return null;
	const lower = ua.toLowerCase();
	return AI_BOTS.find((bot) => lower.includes(bot.toLowerCase())) ?? null;
}
