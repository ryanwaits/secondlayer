import { llmsApiTxt } from "@/lib/llms-api";

export const revalidate = 3600;

export function GET() {
	return new Response(llmsApiTxt(), {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
