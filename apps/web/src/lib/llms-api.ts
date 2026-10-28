import { allEndpoints } from "@/app/(www)/docs/api-reference/spec";
import { SITE } from "./docs-agent";

export const OPENAPI_URL = "https://api.secondlayer.tools/v1/openapi.json";

/** The `.md` twin of one endpoint, as served by the docs `[...slug]` route. */
export function endpointMarkdownUrl(anchor: string): string {
	return `${SITE}/docs/api-reference/${anchor}.md`;
}

/** `llms-api.txt`: the hosted OpenAPI URL plus one line per endpoint, each linking its markdown page. */
export function llmsApiTxt(): string {
	const lines = allEndpoints().map(
		(e) =>
			`- ${e.method} ${e.path}: ${(e.op.summary ?? e.op.operationId).trim()} → ${endpointMarkdownUrl(e.anchor)}`,
	);
	return `# secondlayer API endpoints

> Every HTTP endpoint as its own markdown page.
> Guides in one file: ${SITE}/llms-full.txt
> Index: ${SITE}/llms.txt

Hosted OpenAPI: ${OPENAPI_URL}

## Endpoints
${lines.join("\n")}
`;
}
