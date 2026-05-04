export const L2_INTERNAL_STREAMS_TENANT_ID = "tenant_streams_l2_internal";

const DEFAULT_L2_INTERNAL_STREAMS_API_KEY = "sk-sl_streams_l2_internal";

export function defaultInternalStreamsApiKey(): string {
	return (
		process.env.STREAMS_INTERNAL_API_KEY || DEFAULT_L2_INTERNAL_STREAMS_API_KEY
	);
}
