/** The Lab renders in local dev and on Vercel preview deploys (behind Deployment Protection), never in a production build. */
export function labEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.NODE_ENV === "development" || env.VERCEL_ENV === "preview";
}
