import { describe, expect, it } from "bun:test";
import { createApiApp } from "../create-app.ts";
import { renderLocalConsole } from "./instance-catalog.ts";

class StubElement {
	tag: string;
	className = "";
	href = "";
	children: Array<StubElement | string> = [];
	private _textContent = "";

	constructor(tag: string) {
		this.tag = tag;
	}

	get textContent(): string {
		return this._textContent;
	}

	set textContent(value: string) {
		this._textContent = value;
		this.children = [];
	}

	get innerHTML(): string {
		throw new Error("innerHTML must not be read");
	}

	set innerHTML(_value: string) {
		throw new Error("innerHTML must not be assigned");
	}

	append(...nodes: Array<StubElement | string>): void {
		this.children.push(...nodes);
	}

	replaceChildren(...nodes: Array<StubElement | string>): void {
		this._textContent = "";
		this.children = [...nodes];
	}
}

function collectElements(root: StubElement): StubElement[] {
	const out: StubElement[] = [root];
	for (const child of root.children) {
		if (child instanceof StubElement) {
			out.push(...collectElements(child));
		}
	}
	return out;
}

describe("OSS local console", () => {
	it("uses createElement and textContent without innerHTML", () => {
		const html = renderLocalConsole();
		expect(html).not.toContain("innerHTML");
		expect(html).toContain("createElement");
		expect(html).toContain("textContent");
	});

	it("renders hostile catalog values via textContent only", async () => {
		const html = renderLocalConsole();
		const match = html.match(/<script>([\s\S]*?)<\/script>/);
		expect(match).not.toBeNull();
		const script = match?.[1] ?? "";

		const hostileName = "<img src=x onerror=alert(1)>";
		const hostileNetwork = "<script>alert(2)</script>";
		const root = new StubElement("div");
		const created: StubElement[] = [];

		const mockDocument = {
			getElementById(id: string) {
				return id === "root" ? root : null;
			},
			createElement(tag: string) {
				const el = new StubElement(tag);
				created.push(el);
				return el;
			},
		};

		const mockFetch = async () => ({
			json: async () => ({
				network: hostileNetwork,
				mode: "oss",
				subgraphs: [
					{
						name: "transfers",
						status: "active",
						last_processed_block: 42,
					},
				],
				webhooks: [
					{
						name: hostileName,
						status: "active",
						kind: "tx",
					},
				],
			}),
		});

		const run = new Function("fetch", "document", script);
		run(mockFetch, mockDocument);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(root.textContent).toBe("");
		const elements = collectElements(root);
		const codeTexts = elements
			.filter((el) => el.tag === "code")
			.map((el) => el.textContent);

		expect(codeTexts).toContain(hostileName);
		expect(codeTexts).toContain(hostileNetwork);
		expect(codeTexts).toContain("oss");
		expect(codeTexts).toContain("42");
		expect(created.some((el) => el.tag === "img")).toBe(false);
	});

	it("serves /console with X-Frame-Options and Content-Security-Policy headers", async () => {
		const app = createApiApp("oss");
		const res = await app.request("/console");

		expect(res.status).toBe(200);
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
		const csp = res.headers.get("Content-Security-Policy") ?? "";
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("frame-ancestors 'none'");
	});
});
