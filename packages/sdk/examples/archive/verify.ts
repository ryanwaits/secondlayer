import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer();

const result = await sl.archive.verify({
	against: "https://archive.secondlayer.tools/latest.json",
	fromBlock: 0,
	toBlock: 99_999,
});

for (const range of result.ranges) {
	if (range.status === "match") continue;
	console.log(
		`${range.dataset} ${range.from_block}-${range.to_block}: ${range.status}`,
	);
}

// !callout[/unanchored/] Could not check, so it is never success: the archive was unreachable or its signature failed.
if (result.status === "unanchored") process.exit(2);
if (result.status === "diverged") process.exit(1);
console.log("local data matches the archive");
