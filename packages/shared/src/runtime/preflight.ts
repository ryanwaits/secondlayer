/**
 * Boot-time resource preflight — the thing that makes the guardrail floors real.
 *
 * `preflightResources` existed and was correct for a long time, but nothing
 * called it, so the self-host docs claimed "constrained boxes fail at start"
 * while no box ever did. This module closes that gap.
 *
 * The refusal is deliberately overridable. Enforcing a floor on a runtime that
 * is already released can stop a running install from coming back up after an
 * upgrade — a box that was undersized yesterday is still undersized today, and
 * discovering that during a restart is the worst possible moment. So an
 * operator can proceed past the refusal with SECONDLAYER_ALLOW_UNDERSIZED,
 * which converts a silent risk into an acknowledged one. That is the honest
 * trade: we refuse by default, and we never take away the operator's ability to
 * run their own box.
 */
import { type GuardrailNetwork, preflightResources } from "./guardrails.ts";
import { type MeasuredResources, measureResources } from "./resources.ts";

export const UNDERSIZED_OVERRIDE = "SECONDLAYER_ALLOW_UNDERSIZED";

export type PreflightDecision = {
	action: "pass" | "warn" | "refuse";
	messages: string[];
};

function isOverridden(env: Record<string, string | undefined>): boolean {
	return env[UNDERSIZED_OVERRIDE]?.trim().toLowerCase() === "true";
}

export function decidePreflight(input: {
	measured: MeasuredResources;
	mode: "external" | "stacks" | "full";
	network: GuardrailNetwork;
	env?: Record<string, string | undefined>;
}): PreflightDecision {
	const env = input.env ?? {};
	const result = preflightResources(
		input.measured.snapshot,
		input.mode,
		input.network,
	);

	const messages: string[] = [];
	// Say what we could not see. An operator debugging a surprising pass
	// deserves to know the check was partial.
	if (input.measured.unknown.length > 0) {
		messages.push(
			`resource preflight could not measure: ${input.measured.unknown.join(", ")}`,
		);
	}

	if (result.ok) {
		return { action: messages.length > 0 ? "warn" : "pass", messages };
	}

	messages.push(...result.errors);
	if (isOverridden(env)) {
		messages.push(
			`${UNDERSIZED_OVERRIDE}=true — starting anyway. This box is below the documented floor; expect to run out of disk as history accumulates.`,
		);
		return { action: "warn", messages };
	}

	messages.push(
		`Refusing to start. Resize the box, or set ${UNDERSIZED_OVERRIDE}=true to proceed at your own risk. Sizing guidance: https://www.secondlayer.tools/docs/self-host#guardrails`,
	);
	return { action: "refuse", messages };
}

/** Measure this box and decide. Returns the decision; the caller exits. */
export async function runPreflight(input: {
	dataDir: string;
	mode: "external" | "stacks" | "full";
	network: GuardrailNetwork;
	query?: (sql: string) => Promise<Array<Record<string, unknown>>>;
	env?: Record<string, string | undefined>;
}): Promise<PreflightDecision> {
	const measured = await measureResources({
		dataDir: input.dataDir,
		query: input.query,
	});
	return decidePreflight({
		measured,
		mode: input.mode,
		network: input.network,
		env: input.env,
	});
}
