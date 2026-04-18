import { z } from "zod";

export const AddressProps = z.object({
	value: z.string().describe("Stacks principal (SP…/SM…/ST…)"),
	bns: z.string().nullable().optional().describe("Optional BNS override"),
	truncate: z.boolean().optional().default(true),
});

export type AddressPropsType = z.infer<typeof AddressProps>;
