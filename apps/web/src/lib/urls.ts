// Cross-host URL helpers for the kept auth surface (auth-bar links to the
// app host when one is configured, auth flows link back to marketing).
//
// Every helper is a no-op until the matching NEXT_PUBLIC_*_URL env is set:
// `marketingUrl("/login")` returns a plain relative "/login" when
// unconfigured, so Vercel previews with no app subdomain keep working.

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
const MARKETING_BASE = process.env.NEXT_PUBLIC_MARKETING_URL?.replace(
	/\/$/,
	"",
);

/** Link to the marketing host. Absolute when configured, else relative. */
export function marketingUrl(path = "/"): string {
	return MARKETING_BASE ? `${MARKETING_BASE}${path}` : path;
}

function hostnameOf(base: string | undefined): string | null {
	if (!base) return null;
	try {
		return new URL(base).host;
	} catch {
		return null;
	}
}

/** Host (incl. port) of the app subdomain, or null when unconfigured. */
export function appHostname(): string | null {
	return hostnameOf(APP_BASE);
}
