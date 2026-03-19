import { SecondLayer } from "@secondlayer/sdk";

let instance: SecondLayer | null = null;

/** Lazy SDK singleton from SECONDLAYER_API_KEY env var. */
export function getClient(): SecondLayer {
  if (!instance) {
    const apiKey = process.env.SECONDLAYER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "SECONDLAYER_API_KEY environment variable is required. " +
        "Get your key at https://app.secondlayer.tools/settings/api-keys"
      );
    }
    instance = new SecondLayer({ apiKey });
  }
  return instance;
}
