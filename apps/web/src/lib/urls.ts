// Cross-host URL helper for the auth flows, which link back to marketing.
//
// A no-op until NEXT_PUBLIC_MARKETING_URL is set:
// `marketingUrl("/signin")` returns a plain relative "/signin" when
// unconfigured, so Vercel previews with no app subdomain keep working.

const MARKETING_BASE = process.env.NEXT_PUBLIC_MARKETING_URL?.replace(
	/\/$/,
	"",
);

/** Link to the marketing host. Absolute when configured, else relative. */
export function marketingUrl(path = "/"): string {
	return MARKETING_BASE ? `${MARKETING_BASE}${path}` : path;
}
