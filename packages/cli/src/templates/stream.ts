import type { CreateStream } from "@secondlayer/shared/schemas";

export function generateStreamTemplate(
	name: string,
	endpointUrl?: string,
): CreateStream {
	return {
		name,
		endpointUrl: endpointUrl || "https://example.com/endpoint",
		filters: [
			{
				type: "contract_call",
				contractId: "SP000000000000000000002Q6VF78.pox-4",
			},
		],
		options: {
			decodeClarityValues: true,
			includeRawTx: false,
			includeBlockMetadata: true,
			rateLimit: 10,
			timeoutMs: 10000,
			maxRetries: 3,
		},
	};
}
