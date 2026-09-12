import { afterEach, describe, expect, mock, test } from "bun:test";
import {
	meterBlocksProcessed,
	meterDeliveryAttempt,
	resetHostedMeterHooks,
	setHostedMeterHooks,
} from "./hosted-meter.ts";

afterEach(() => {
	resetHostedMeterHooks();
});

describe("hosted-meter hooks", () => {
	test("default no-op returns true", async () => {
		expect(await meterBlocksProcessed("acc", 10, "sg")).toBe(true);
		expect(await meterDeliveryAttempt("acc", "sub-1")).toBe(true);
	});

	test("calls mock after setHostedMeterHooks", async () => {
		const onBlocksProcessed = mock(async () => true);
		const onDeliveryAttempt = mock(async () => true);
		setHostedMeterHooks({ onBlocksProcessed, onDeliveryAttempt });
		expect(await meterBlocksProcessed("acc", 3, "sg")).toBe(true);
		expect(await meterDeliveryAttempt("acc", "sub-1")).toBe(true);
		expect(onBlocksProcessed).toHaveBeenCalledTimes(1);
		expect(onBlocksProcessed).toHaveBeenCalledWith("acc", 3, "sg");
		expect(onDeliveryAttempt).toHaveBeenCalledTimes(1);
		expect(onDeliveryAttempt).toHaveBeenCalledWith("acc", "sub-1");
	});

	test("empty accountId skipped", async () => {
		const onBlocksProcessed = mock(async () => true);
		const onDeliveryAttempt = mock(async () => true);
		setHostedMeterHooks({ onBlocksProcessed, onDeliveryAttempt });
		expect(await meterBlocksProcessed("", 3, "sg")).toBe(true);
		expect(await meterBlocksProcessed(null, 3, "sg")).toBe(true);
		expect(await meterBlocksProcessed(undefined, 3, "sg")).toBe(true);
		expect(await meterBlocksProcessed("acc", 0, "sg")).toBe(true);
		expect(await meterDeliveryAttempt("", "sub-1")).toBe(true);
		expect(await meterDeliveryAttempt(null, "sub-1")).toBe(true);
		expect(await meterDeliveryAttempt(undefined, "sub-1")).toBe(true);
		expect(onBlocksProcessed).toHaveBeenCalledTimes(0);
		expect(onDeliveryAttempt).toHaveBeenCalledTimes(0);
	});

	test("resetHostedMeterHooks restores no-op", async () => {
		const onBlocksProcessed = mock(async () => false);
		setHostedMeterHooks({ onBlocksProcessed });
		resetHostedMeterHooks();
		expect(await meterBlocksProcessed("acc", 3, "sg")).toBe(true);
		expect(onBlocksProcessed).toHaveBeenCalledTimes(0);
	});

	test("propagates false from hook", async () => {
		setHostedMeterHooks({
			onBlocksProcessed: async () => false,
			onDeliveryAttempt: async () => false,
		});
		expect(await meterBlocksProcessed("acc", 3, "sg")).toBe(false);
		expect(await meterDeliveryAttempt("acc", "sub-1")).toBe(false);
	});
});
