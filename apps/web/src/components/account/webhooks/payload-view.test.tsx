import { describe, expect, test } from "bun:test";
import type { ChainTrigger } from "@secondlayer/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import {
	JsonView,
	PayloadPanel,
	answeredAttempt,
	clampString,
	markMatcher,
	parseBody,
} from "./payload-view";

// A real delivery: the fastpool unstake print event.
const SENT = {
	type: "chain.print_event.apply",
	timestamp: "2026-10-16T17:39:14.000Z",
	data: {
		event: {
			data: {
				topic: "print",
				value: {
					topic: "unstake",
					signer:
						"SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager",
					staker: "SP134V7CBZZ4C356R2WTNE1522GGCZJ6YRN2A5SWG",
					"amount-ustx": "100000000000",
					"unlock-cycle": "146",
					"first-reward-cycle": "143",
					"unlock-burn-height": "972650",
				},
				raw_value:
					"0x0c000000070b616d6f756e742d75737478010000000000000000000000174876e8001266697273742d7265776172642d6379636c65010000000000000000000000000000008f067369676e65720616296a283b358830510c486f90c13d924b92a6590e1e66617374706f6f6c2d6d61783530302d7369676e65722d6d616e61676572067374616b65720516464d9d8bffc8c194d817355704a21420cfc8dec505746f7069630d00000007756e7374616b6512756e6c6f636b2d6275726e2d68656967687401000000000000000000000000000ed76a0c756e6c6f636b2d6379636c650100000000000000000000000000000092",
				contract_id: "SP000000000000000000002Q6VF78.pox-5",
			},
			type: "contract_event",
			tx_id:
				"0x9b5aa03c09d0c7f0939d0398e60ac7a521b23c3ce92a9781e9bbfe86604dcc41",
			event_index: 2,
		},
		tx_id: "0x9b5aa03c09d0c7f0939d0398e60ac7a521b23c3ce92a9781e9bbfe86604dcc41",
		action: "apply",
		trigger: "print_event",
		canonical: true,
		block_hash:
			"0xb2b876c112e5525d2ce463732a34ecd64ad7507cbdf85f21a26a050028b89d1d",
		block_time: "2026-10-16T17:39:03.000Z",
		block_height: 9227006,
	},
};

const FASTPOOL: ChainTrigger[] = [
	{
		type: "print_event",
		contractId: "SP000000000000000000002Q6VF78.pox-5",
		where: {
			signer: [
				"SP21YTSM60CAY6D011EZVEVNKXVW8FVZE198XEFFP.fastpool-1-signer-manager",
				"SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager",
			],
		},
	},
];

describe("markMatcher", () => {
	const matches = markMatcher(FASTPOOL);

	test("a filter value matches exactly, anything else does not", () => {
		expect(
			matches(
				"SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager",
			),
		).toBe(true);
		expect(matches("SP134V7CBZZ4C356R2WTNE1522GGCZJ6YRN2A5SWG")).toBe(false);
	});

	test("a value ending in * matches by prefix", () => {
		const wild = markMatcher([
			{ type: "print_event", contractId: "SP1.swap-*" },
		] as ChainTrigger[]);
		expect(wild("SP1.swap-x-for-y")).toBe(true);
		expect(wild("SP1.other")).toBe(false);
	});
});

describe("clampString", () => {
	test("an 80-character JSON string is not clamped", () => {
		expect(clampString(JSON.stringify("a".repeat(78)))).toBeNull();
	});

	test("raw_value hides all but its head and tail", () => {
		const clamp = clampString(JSON.stringify(SENT.data.event.data.raw_value));
		expect(clamp?.hidden).toBe(452);
		expect(clamp?.head.length).toBe(26);
		expect(clamp?.tail.length).toBe(12);
	});
});

describe("JsonView", () => {
	const html = renderToStaticMarkup(
		<JsonView value={SENT} isMarked={markMatcher(FASTPOOL)} />,
	);

	test("the signer and contract_id values are marked", () => {
		expect(html).toContain(
			'<span class="m"><span class="s">&quot;SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.fastpool-max500-signer-manager&quot;</span></span>',
		);
		expect(html).toContain(
			'<span class="m"><span class="s">&quot;SP000000000000000000002Q6VF78.pox-5&quot;</span></span>',
		);
	});

	test("raw_value is clamped with its hidden count", () => {
		expect(html).toContain(">+452<");
	});

	test("a 66-character tx_id is shown whole", () => {
		expect(html).toContain(SENT.data.tx_id);
		expect(html.match(/class="pv-more"/g)?.length).toBe(1);
	});

	test("unmarked values stay unmarked without a matcher", () => {
		expect(renderToStaticMarkup(<JsonView value={SENT} />)).not.toContain(
			'class="m"',
		);
	});
});

describe("parseBody", () => {
	test("a non-JSON body comes back raw", () => {
		expect(parseBody("<html>nope</html>")).toEqual({
			raw: "<html>nope</html>",
		});
	});

	test("JSON parses and an empty body is null", () => {
		expect(parseBody('{"a":1}')).toEqual({ json: { a: 1 } });
		expect(parseBody(null)).toBeNull();
	});
});

describe("the Response tab after a retry", () => {
	const attempts = [
		{ id: "a1", statusCode: 502, responseBody: "bad gateway" },
		{ id: "a2", statusCode: null, responseBody: null },
	];

	test("a timed-out final retry still shows the earlier attempt's body and status", () => {
		const answered = answeredAttempt(attempts);
		expect(answered.id).toBe("a1");
		const html = renderToStaticMarkup(
			<PayloadPanel
				load={{
					status: "ok",
					detail: { payload: null, responseBody: null } as never,
				}}
				triggers={[]}
				responseBody={answered.responseBody}
				statusCode={answered.statusCode}
				responseIsLatest={answered.id === "a2"}
				host="example.com"
			/>,
		);
		expect(html).toContain("Response 502");
		expect(html).toContain("bad gateway");
	});

	test("with no body on any attempt the newest attempt answers", () => {
		expect(
			answeredAttempt([
				{ id: "a1", responseBody: null },
				{ id: "a2", responseBody: null },
			]).id,
		).toBe("a2");
	});
});
