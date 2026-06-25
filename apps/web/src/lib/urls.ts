// Host-split URL helpers. The authenticated console lives on app.secondlayer.tools
// and marketing on secondlayer.tools. Both run from this one Next.js app; which
// host a request lands on is decided in middleware. These helpers build the
// cross-host links.
//
// Every helper is a no-op until the matching NEXT_PUBLIC_*_URL env is set:
// `appUrl("/login")` returns a plain relative "/login" when unconfigured, so the
// app behaves exactly as the pre-split single-domain build (and Vercel previews,
// which have no app subdomain, keep working).

const APP_BASE = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
const MARKETING_BASE = process.env.NEXT_PUBLIC_MARKETING_URL?.replace(
	/\/$/,
	"",
);

/** Link to the authenticated app host. Absolute when configured, else relative. */
export function appUrl(path = "/"): string {
	return APP_BASE ? `${APP_BASE}${path}` : path;
}

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

/** Host (incl. port) of the marketing domain, or null when unconfigured. */
export function marketingHostname(): string | null {
	return hostnameOf(MARKETING_BASE);
}
