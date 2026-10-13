import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer();

const manifest = await sl.archive.latest();
const wanted = sl.archive.partitions(manifest, {
	dataset: "blocks",
	fromBlock: 0,
	toBlock: 99_999,
});
const paths = wanted.map((p) => p.path);

// !callout[/quote/] Prices the fetch against your balance. Nothing is charged yet.
const quote = await sl.archive.quote({ paths, flow: "bootstrap" });
if (!quote.sufficient) {
	console.error(`need $${quote.usd}, balance is short`);
	process.exit(2);
}

// !callout[/fetch/] This is the step that draws credits. Each URL is short-lived.
const { urls } = await sl.archive.fetch({ paths, flow: "bootstrap" });

for (const partition of wanted) {
	const url = urls.find((u) => u.path === partition.path)?.url;
	// !callout[/download/] Checks the sha256 against the manifest before returning the bytes.
	const bytes = await sl.archive.download(partition, { url });
	await Bun.write(`archive/${partition.path}`, bytes);
}
