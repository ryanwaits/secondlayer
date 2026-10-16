import { expect, test } from "bun:test";
import type { Insight as ServerInsight } from "@secondlayer/shared/schemas";
import type { Insight } from "./insights";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same: Same<Insight, ServerInsight> = true;

test("web Insight type matches the server contract", () => {
	expect(same).toBe(true);
});
