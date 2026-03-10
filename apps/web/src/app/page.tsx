import Link from "next/link";
import { HomeAnnotations } from "./home-annotations";
import { NewBadge } from "@/components/new-badge";

const categories = [
  {
    label: "Products",
    items: [
      { name: "Streams", href: "/streams", date: "10/03", isNew: true, desc: "Real-time event webhooks" },
      { name: "Views", href: "/views", date: "10/03", desc: "Custom subgraphs for indexed data" },
    ],
  },
  {
    label: "Packages",
    items: [
      { name: "Stacks", href: "/stacks", date: "10/03", desc: "Viem-style SDK for Stacks" },
      { name: "SDK", href: "/sdk", date: "10/03", desc: "Typed client for the Secondlayer API" },
      { name: "CLI", href: "/cli", date: "10/03", desc: "One command, every operation" },
    ],
  },
];

export default function HomePage() {
  return (
    <div className="homepage">
      <header className="page-header">
        <h1 className="page-title">Secondlayer</h1>
      </header>

      <HomeAnnotations />

      <section className="index-group" style={{ marginTop: "var(--spacing-xl)" }}>
        {categories.map((category) => (
          <div key={category.label} className="index-year-group">
            <div className="index-year">{category.label}</div>
            <ul className="index-list">
              {category.items.map((item) => (
                <li key={item.href} className="index-item">
                  <Link href={item.href} className="index-link">
                    <span className="index-link-label">
                      {item.name}
                      {item.isNew && <NewBadge />}
                      {item.desc && <span className="index-desc">{item.desc}</span>}
                    </span>
                    <span className="index-date">{item.date}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
