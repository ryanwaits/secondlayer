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
	test("default no-op", async () => {
		await meterBlocksProcessed("acc", 10);
		await meterDeliveryAttempt("acc");
	});

	test("calls mock after setHostedMeterHooks", async () => {
		const onBlocksProcessed = mock(async () => {});
		const onDeliveryAttempt = mock(async () => {});
		setHostedMeterHooks({ onBlocksProcessed, onDeliveryAttempt });
		await meterBlocksProcessed("acc", 3);
		await meterDeliveryAttempt("acc");
		expect(onBlocksProcessed).toHaveBeenCalledTimes(1);
		expect(onBlocksProcessed).toHaveBeenCalledWith("acc", 3);
		expect(onDeliveryAttempt).toHaveBeenCalledTimes(1);
		expect(onDeliveryAttempt).toHaveBeenCalledWith("acc");
	});

	test("empty accountId skipped", async () => {
		const onBlocksProcessed = mock(async () => {});
		const onDeliveryAttempt = mock(async () => {});
		setHostedMeterHooks({ onBlocksProcessed, onDeliveryAttempt });
		await meterBlocksProcessed("", 3);
		await meterBlocksProcessed(null, 3);
		await meterBlocksProcessed(undefined, 3);
		await meterBlocksProcessed("acc", 0);
		await meterDeliveryAttempt("");
		await meterDeliveryAttempt(null);
		await meterDeliveryAttempt(undefined);
		expect(onBlocksProcessed).toHaveBeenCalledTimes(0);
		expect(onDeliveryAttempt).toHaveBeenCalledTimes(0);
	});

	test("resetHostedMeterHooks restores no-op", async () => {
		const onBlocksProcessed = mock(async () => {});
		setHostedMeterHooks({ onBlocksProcessed });
		resetHostedMeterHooks();
		await meterBlocksProcessed("acc", 3);
		expect(onBlocksProcessed).toHaveBeenCalledTimes(0);
	});
});
