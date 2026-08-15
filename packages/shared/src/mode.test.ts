import { afterEach, describe, expect, test } from "bun:test";
import {
	getDeclaredInstanceMode,
	getInstanceMode,
	isMeteredReads,
	isPlatformMode,
} from "./mode.ts";

const saved = {
	INSTANCE_MODE: process.env.INSTANCE_MODE,
	METERED_READS: process.env.METERED_READS,
};

function setEnv(mode?: string, metered?: string) {
	if (mode === undefined) delete process.env.INSTANCE_MODE;
	else process.env.INSTANCE_MODE = mode;
	if (metered === undefined) delete process.env.METERED_READS;
	else process.env.METERED_READS = metered;
}

afterEach(() => {
	setEnv(saved.INSTANCE_MODE, saved.METERED_READS);
});

describe("instance mode", () => {
	test("archive aliases platform behaviorally but stays visible as declared", () => {
		setEnv("archive");
		expect(getInstanceMode()).toBe("platform");
		expect(isPlatformMode()).toBe(true);
		expect(getDeclaredInstanceMode()).toBe("archive");
	});

	test("unset and unknown values default to oss", () => {
		setEnv(undefined);
		expect(getInstanceMode()).toBe("oss");
		setEnv("something-else");
		expect(getInstanceMode()).toBe("oss");
		expect(getDeclaredInstanceMode()).toBe("oss");
	});

	test("metered reads arm on platform and archive, never on bare oss", () => {
		setEnv("platform");
		expect(isMeteredReads()).toBe(true);
		setEnv("archive");
		expect(isMeteredReads()).toBe(true);
		setEnv("oss");
		expect(isMeteredReads()).toBe(false);
	});

	test("METERED_READS overrides both directions", () => {
		setEnv("archive", "false");
		expect(isMeteredReads()).toBe(false);
		setEnv("oss", "true");
		expect(isMeteredReads()).toBe(true);
	});
});
