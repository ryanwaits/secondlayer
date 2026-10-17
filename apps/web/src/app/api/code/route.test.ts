import { describe, expect, test } from "bun:test";
import { POST } from "./route";

const post = (body: unknown) =>
	POST(
		new Request("http://localhost/api/code", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);

const block = { code: "const a = 1;", title: "a.ts", lines: 1 };

describe("code render route", () => {
	test("an annotated line renders as a row carrying its ref", async () => {
		const res = await post({
			blocks: [
				{
					code: "// !ref(1:1) contractId\nconst a = 1;",
					title: "a.ts",
					lines: 7,
				},
			],
		});
		expect(res.status).toBe(200);
		const { blocks } = await res.json();
		expect(blocks).toHaveLength(1);
		expect(blocks[0].html).toContain('data-refs="contractId"');
		expect(blocks[0].className).toContain("cb");
	});

	test("line numbers continue from the requested start", async () => {
		const res = await post({ blocks: [{ ...block, lines: 12 }] });
		const { blocks } = await res.json();
		expect(blocks[0].html).toContain(">12<");
	});

	test("more than 10 blocks is 400", async () => {
		const res = await post({ blocks: Array.from({ length: 11 }, () => block) });
		expect(res.status).toBe(400);
	});

	test("oversize code is 400", async () => {
		const res = await post({
			blocks: [{ ...block, code: "x".repeat(8001) }],
		});
		expect(res.status).toBe(400);
	});

	test("bad lines and a malformed body are 400", async () => {
		expect((await post({ blocks: [{ ...block, lines: 0 }] })).status).toBe(400);
		expect((await post({ blocks: [{ ...block, lines: 1.5 }] })).status).toBe(
			400,
		);
		expect((await post({ blocks: [] })).status).toBe(400);
		expect((await post(null)).status).toBe(400);
	});
});
