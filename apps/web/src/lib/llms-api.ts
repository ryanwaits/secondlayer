import { allEndpoints } from "@/app/(www)/docs/api-reference/spec";
import { SITE } from "./docs-agent";

export const OPENAPI_URL = "https://api.secondlayer.tools/v1/openapi.json";

export function endpointMarkdownUrl(anchor: string): string {
	return `${SITE}/docs/api-reference/${anchor}.md`;
}

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
