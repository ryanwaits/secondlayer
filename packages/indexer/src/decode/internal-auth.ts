export const INTERNAL_STREAMS_TENANT_ID = "tenant_streams_decode_internal";

const DEFAULT_INTERNAL_STREAMS_API_KEY = "sk-sl_streams_decode_internal";

export function defaultInternalStreamsApiKey(): string {
	return (
		process.env.STREAMS_INTERNAL_API_KEY || DEFAULT_INTERNAL_STREAMS_API_KEY
	);
}
