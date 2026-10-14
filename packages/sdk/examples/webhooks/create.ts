import { SecondLayer, trigger } from "@secondlayer/sdk";

const sl = new SecondLayer({
	apiKey: process.env.SECONDLAYER_API_KEY,
});

const { webhook, signingSecret } = await sl.webhooks.create({
	name: "sbtc-mints",
	url: "https://my-app.com/webhook",
	triggers: [
		trigger.ftMint({
			assetIdentifier:
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
		}),
	],
});

console.log(`created ${webhook.id} (${webhook.status})`);
// !callout[/signingSecret/] Returned once. Store it: verifyWebhookSignature needs it to check each delivery.
console.log(`WEBHOOK_SECRET=${signingSecret}`);
