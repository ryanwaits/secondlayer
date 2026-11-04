import { afterEach, describe, expect, test } from "bun:test";
import { clearRequestCache } from "@/lib/request-cache";
import type { ChainTrigger } from "@secondlayer/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { answeredAttempt } from "./delivery-view";
import {
	JsonView,
	PayloadPanel,
	PayloadView,
	clampString,
	markMatcher,
	parseBody,
	prefetchDelivery,
	prefetchOnIntent,
	readDelivery,
} from "./payload-view";
import { attempt } from "./webhook.fixtures";

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
				webhookName="hook"
				attempts={[attempt()]}
				finding={null}
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

describe("the payload viewer on an asleep stack", () => {
	const html = renderToStaticMarkup(
		<PayloadPanel
			load={{ status: "asleep" }}
			triggers={[]}
			responseBody='{"ok":true}'
			statusCode={200}
			responseIsLatest
			host="example.com"
			webhookName="hook"
			attempts={[attempt()]}
			finding={null}
		/>,
	);

	test("opens on the response, which came with the deliveries list", () => {
		expect(html).toContain('aria-selected="true">Response 200');
		expect(html).toContain("What example.com sent back");
		expect(html).not.toContain("Couldn&#x27;t load the payload.");
	});

	test("disables Sent and says resuming shows it", () => {
		expect(html).toContain('aria-disabled="true"');
		expect(html).toContain("Resume this webhook to see what was sent");
	});
});

describe("the payload viewer's Fields tab", () => {
	const raw = SENT.data.event.data.raw_value;
	const panel = (payload: unknown) =>
		renderToStaticMarkup(
			<PayloadPanel
				load={{
					status: "ok",
					detail: { payload, responseBody: null } as never,
				}}
				triggers={FASTPOOL}
				responseBody={null}
				statusCode={200}
				responseIsLatest
				host="example.com"
				webhookName="hook"
				attempts={[attempt()]}
				finding={null}
			/>,
		);

	test("a payload with event data opens on Fields", () => {
		const html = panel({
			event: { data: SENT.data.event.data },
			trigger: "print_event",
		});
		expect(html).toContain('aria-selected="true">Fields');
		expect(html).toContain("pv-fields");
		expect(html).toContain("print_event");
	});

	test("a payload without event data has no Fields tab and opens on Sent", () => {
		const html = panel({ hello: "world" });
		expect(html).not.toContain("Fields");
		expect(html).toContain('aria-selected="true">Sent');
	});

	test("raw_value is clamped in Fields with its hidden count", () => {
		const html = panel({ event: { data: SENT.data.event.data } });
		expect(html).toContain(`>+${raw.length - 38}<`);
	});

	test("filter values are marked in Fields", () => {
		const html = panel({ event: { data: SENT.data.event.data } });
		expect(html).toContain(
			'<span class="m"><span class="s">SP000000000000000000002Q6VF78.pox-5</span></span>',
		);
	});

	test("block and tx link out to the explorer", () => {
		const html = panel({
			event: { data: SENT.data.event.data },
			block_hash: "0xabc",
		});
		expect(html).toContain(
			"https://explorer.hiro.so/block/0xabc?chain=mainnet",
		);
		expect(html).toContain("https://explorer.hiro.so/txid/0x");
	});
});

describe("delivery prefetch", () => {
	const realFetch = globalThis.fetch;
	let calls = 0;
	afterEach(() => {
		globalThis.fetch = realFetch;
		clearRequestCache();
	});
	function stubFetch() {
		calls = 0;
		globalThis.fetch = (async () => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 5));
			return new Response(JSON.stringify({ id: "d1", payload: SENT }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;
	}
	const view = (deliveryId: string) => (
		<PayloadView
			webhookId="wh"
			deliveryId={deliveryId}
			asleep={false}
			triggers={[]}
			responseBody={null}
			statusCode={200}
			responseIsLatest
			host="example.com"
			webhookName="hook"
			attempts={[attempt()]}
			finding={null}
		/>
	);

	test("a hover read and the click's read are one request", async () => {
		stubFetch();
		await Promise.all([
			prefetchDelivery("wh", "d-share"),
			prefetchDelivery("wh", "d-share"),
			readDelivery("wh", "d-share"),
		]);
		expect(calls).toBe(1);
	});

	test("a prefetched delivery renders ok on the first frame", async () => {
		stubFetch();
		await prefetchDelivery("wh", "d-first");
		expect(renderToStaticMarkup(view("d-first"))).not.toContain("Loading");
		expect(calls).toBe(1);
	});

	test("an unread delivery renders the loading frame", () => {
		stubFetch();
		expect(renderToStaticMarkup(view("d-cold"))).toContain("Loading");
	});

	test("an asleep stack or an open row makes no request", async () => {
		stubFetch();
		const base = { webhookId: "wh", deliveryId: "d-none" };
		prefetchOnIntent({ ...base, asleep: true, open: false });
		prefetchOnIntent({ ...base, asleep: false, open: true });
		await new Promise((resolve) => setTimeout(resolve, 15));
		expect(calls).toBe(0);
	});

	test("a failed prefetch does not throw", async () => {
		globalThis.fetch = (async () => {
			throw new Error("down");
		}) as unknown as typeof fetch;
		await prefetchDelivery("wh", "d-fail");
	});
});
