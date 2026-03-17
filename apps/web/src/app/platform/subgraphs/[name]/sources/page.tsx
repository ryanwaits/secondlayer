import Link from "next/link";

export default function SubgraphSourcesPage() {
  return (
    <>
      <p className="dash-page-desc">
        Sources are defined in your subgraph code.
      </p>
      <div className="dash-hint" style={{ marginTop: 12 }}>
        <Link href="/site/subgraphs" style={{ color: "var(--accent-purple)" }}>
          Read the docs
        </Link>{" "}
        to learn how to configure data sources for your subgraph.
      </div>
    </>
  );
}
