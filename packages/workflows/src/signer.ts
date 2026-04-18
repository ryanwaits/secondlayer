import type { RemoteSignerConfig } from "./types.ts";

/**
 * Signer factories. Pass the result to `WorkflowDefinition.signers`:
 *
 *   import { defineWorkflow, signer } from "@secondlayer/workflows"
 *
 *   export default defineWorkflow({
 *     name: "dca",
 *     trigger: { type: "schedule", cron: "0 0 * * *" },
 *     signers: {
 *       treasury: signer.remote({
 *         endpoint:  "https://signer.acme.com/sign",
 *         publicKey: "03fae8…",
 *         hmacRef:   "treasury",  // resolved at broadcast via `sl secrets set treasury …`
 *       }),
 *     },
 *     handler: async ({ step }) => {
 *       await step.run("pay", () =>
 *         broadcast(tx.transfer({ … }), { signer: "treasury" }),
 *       )
 *     },
 *   })
 *
 * v2 ships `signer.remote` only. MPC + browser-wallet land in a future sprint.
 */
export const signer = {
	remote(opts: Omit<RemoteSignerConfig, "kind">): RemoteSignerConfig {
		return { kind: "remote", ...opts };
	},
} as const;
