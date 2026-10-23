import { describe, expect, test } from "bun:test";
import { groupWaiting } from "./waiting";

const DEPLOYER = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7";
const vault = `${DEPLOYER}.v0-vault-sbtc`;
const dao = `${DEPLOYER}.dao-executor`;

function hook(id: string, name: string) {
	return { id, name };
}

describe("groupWaiting", () => {
	const names = [
		hook("1", `sentinel:${vault}:set-default-flashloan-permissions`),
		hook("2", `sentinel:${dao}:init`),
		hook("3", `sentinel:${vault}:initialize`),
		hook("4", `sentinel:${vault}:set-pause-states`),
		hook("5", `sentinel:${dao}:set-impl`),
		hook("6", `sentinel:${vault}:set-authorized-contract`),
	];

	test("six sentinel watchers on two contracts make two groups in first-seen order", () => {
		const groups = groupWaiting(names);
		expect(groups.map((g) => g.contract)).toEqual([
			"SP1A27…ADJ7.v0-vault-sbtc",
			"SP1A27…ADJ7.dao-executor",
		]);
		expect(groups[0]?.items.map((i) => i.label)).toEqual([
			"set-default-flashloan-permissions",
			"initialize",
			"set-pause-states",
			"set-authorized-contract",
		]);
		expect(groups[1]?.items.map((i) => i.label)).toEqual(["init", "set-impl"]);
	});

	test("an item keeps its id and the full original name as the title", () => {
		const item = groupWaiting(names)[1]?.items[0];
		expect(item).toEqual({
			id: "2",
			label: "init",
			title: `sentinel:${dao}:init`,
		});
	});

	test("a hashed function label is kept as the label", () => {
		const [group] = groupWaiting([
			hook("h", `sentinel:${vault}:~dea842652e52db77`),
		]);
		expect(group?.items[0]?.label).toBe("~dea842652e52db77");
	});

	test("names that do not name a contract land in one trailing group", () => {
		const groups = groupWaiting([
			hook("a", "sentinel:vault-admin"),
			hook("b", `sentinel:${vault}:init`),
			hook("c", "my-hook"),
		]);
		expect(groups.map((g) => g.contract)).toEqual([
			"SP1A27…ADJ7.v0-vault-sbtc",
			null,
		]);
		expect(groups[1]?.items.map((i) => i.label)).toEqual([
			"sentinel:vault-admin",
			"my-hook",
		]);
	});

	test("an unprefixed contract:function name groups too", () => {
		const groups = groupWaiting([hook("u", `${vault}:set-impl`)]);
		expect(groups[0]?.contract).toBe("SP1A27…ADJ7.v0-vault-sbtc");
		expect(groups[0]?.items[0]?.label).toBe("set-impl");
	});
});
