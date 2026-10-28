import { llmsApiTxt } from "@/lib/llms-api";

/** Every endpoint as a markdown URL; built from the spec, so it can't drift. */
export const revalidate = 3600;

export function GET() {
	return new Response(llmsApiTxt(), {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
