import { afterEach, describe, expect, it } from "bun:test";
import { __setDnsLookupForTest, checkEgressAllowed } from "./emitter.ts";

process.env.INSTANCE_MODE = process.env.INSTANCE_MODE ?? "oss";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5440/secondlayer";

/**
 * Table test over the SSRF ranges added on top of the original private/
 * loopback/link-local set: benchmarking (198.18.0.0/15), multicast
 * (224.0.0.0/4), reserved/broadcast (240.0.0.0/4, incl. 255.255.255.255),
 * IPv6 multicast (ff00::/8), and NAT64 (64:ff9b::/96, embedded v4).
 *
 * Each range is exercised two ways: as a literal address in the URL (the
 * synchronous fast-fail path) and as a DNS answer for an innocuous hostname
 * (the resolved-address path — the one that actually matters for rebinding).
 */
const RANGES: {
	name: string;
	literal: string;
	dnsAddress: string;
	family: 4 | 6;
}[] = [
	{
		name: "benchmarking 198.18.0.0/15",
		literal: "198.18.0.1",
		dnsAddress: "198.19.255.254",
		family: 4,
	},
	{
		name: "multicast 224.0.0.0/4",
		literal: "224.0.0.1",
		dnsAddress: "239.255.255.255",
		family: 4,
	},
	{
		name: "reserved 240.0.0.0/4",
		literal: "240.0.0.1",
		dnsAddress: "254.254.254.254",
		family: 4,
	},
	{
		name: "broadcast 255.255.255.255",
		literal: "255.255.255.255",
		dnsAddress: "255.255.255.255",
		family: 4,
	},
	{
		name: "IPv6 multicast ff00::/8",
		literal: "ff02::1",
		dnsAddress: "ff00::",
		family: 6,
	},
	{
		name: "NAT64 64:ff9b::/96 (dotted embedded v4)",
		literal: "64:ff9b::127.0.0.1",
		dnsAddress: "64:ff9b::10.1.2.3",
		family: 6,
	},
	{
		name: "NAT64 64:ff9b::/96 (hex embedded v4)",
		literal: "64:ff9b::7f00:1", // 127.0.0.1
		dnsAddress: "64:ff9b::c0a8:101", // 192.168.1.1
		family: 6,
	},
];

describe("SSRF egress guard — additional ranges", () => {
	afterEach(() => {
		__setDnsLookupForTest(null);
	});

	for (const range of RANGES) {
		it(`refuses ${range.name} as a literal URL address`, async () => {
			const host = range.family === 6 ? `[${range.literal}]` : range.literal;
			const refusal = await checkEgressAllowed(`http://${host}/hook`);
			expect(refusal).toContain("refused private egress");
		});

		it(`refuses ${range.name} as a DNS answer for an innocuous hostname`, async () => {
			const hostname = `range-test-${range.name.replace(/[^a-z0-9]/gi, "")}.test.invalid`;
			__setDnsLookupForTest(async (host) => {
				if (host === hostname) {
					return [{ address: range.dnsAddress, family: range.family }];
				}
				throw new Error(`unexpected DNS lookup for ${host} in this test`);
			});
			const refusal = await checkEgressAllowed(`http://${hostname}/hook`);
			expect(refusal).toContain("refused private egress");
		});
	}

	it("does not widen the block past ff00::/8 (fe00::1 is neither fe80::/10 nor ff00::/8)", async () => {
		// Boundary check for the new `/^ff[0-9a-f]{2}:/` multicast pattern:
		// `fe00::1` shares the `fe` prefix but falls in neither the existing
		// link-local range (`fe80::/10`) nor the new multicast one
		// (`ff00::/8`) — confirms the new regex didn't accidentally widen.
		const refusal = await checkEgressAllowed("http://[fe00::1]/hook");
		expect(refusal).toBeNull();
	});
});
