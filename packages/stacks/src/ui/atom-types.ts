import type { ReactElement } from "react";
import type { z } from "zod";

/**
 * Shared shape for all Stacks UI atom components — keeps `*Component` +
 * the `atoms` registry typed explicitly so oxc's isolated-declarations
 * mode (used by bunup for fast .d.ts generation) can emit the package's
 * declaration files without walking through every atom's props Zod schema.
 */
// biome-ignore lint/suspicious/noExplicitAny: render signature is intentionally loose; runtime validation is the Zod schema above
export type AtomRender = (props: any) => ReactElement;

export interface StacksAtom {
	props: z.ZodTypeAny;
	render: AtomRender;
}
