import Link from "next/link";
import { Eyebrow } from "./eyebrow";

export type ReadingLink = { href: string; title: string; body: string };

/** Three links out to the posts and guides behind a page. */
export function FurtherReading({ items }: { items: readonly ReadingLink[] }) {
	return (
		<div className="band" style={{ paddingTop: 0 }}>
			<div className="shell">
				<div className="sec-head" style={{ marginBottom: 24 }}>
					<Eyebrow noun="Further reading" />
				</div>
				<div className="rest">
					{items.map((item) => (
						<Link href={item.href} key={item.href}>
							<span className="n">{item.title}</span>
							<p>{item.body}</p>
						</Link>
					))}
				</div>
			</div>
		</div>
	);
}
