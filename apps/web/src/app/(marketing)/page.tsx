import { HomeAnnotations } from "./home-annotations";
import { BetaBracket } from "@/components/beta-badge";
import { SiteLink } from "@/components/site-link";

const products = [
  { name: "Streams", href: "/streams", desc: "Real-time event webhooks" },
  { name: "Subgraphs", href: "/subgraphs", desc: "Custom indexers for blockchain data" },
];

const packages = [
  { name: "Stacks", href: "/stacks", version: "0.2.0", desc: "Viem-style SDK for Stacks" },
  { name: "SDK", href: "/sdk", version: "0.5.0", desc: "Typed client for the secondlayer API" },
  { name: "CLI", href: "/cli", version: "1.5.1", desc: "One command, every operation" },
];

function IndexItem({ item }: { item: { name: string; href: string; version?: string; desc: string } }) {
  return (
    <li className="index-item">
      <SiteLink href={item.href} className="index-link">
        <span className="index-link-label">
          {item.name}
          <span className="index-desc">{item.desc}</span>
        </span>
        <span className="index-date">{item.version}</span>
      </SiteLink>
    </li>
  );
}

export default function HomePage() {
  return (
    <div className="homepage">
      <header className="page-header">
        <h1 className="page-title">secondlayer</h1>
      </header>

      <HomeAnnotations />

      <section className="index-group" style={{ marginTop: "var(--spacing-xl)" }}>
        <div className="index-year-group">
          <div className="index-year">Products</div>
          <BetaBracket>
            <ul className="index-list">
              {products.map((item) => (
                <IndexItem key={item.href} item={item} />
              ))}
            </ul>
          </BetaBracket>
        </div>

        <div className="index-year-group">
          <div className="index-year">Packages</div>
          <ul className="index-list">
            {packages.map((item) => (
              <IndexItem key={item.href} item={item} />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
