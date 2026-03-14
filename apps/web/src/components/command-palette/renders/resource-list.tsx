"use client";

import type { ComponentRenderProps } from "@json-render/react";

interface ResourceItem {
  name: string;
  meta?: string;
  status?: "green" | "yellow" | "red";
}

interface ResourceListProps {
  items: ResourceItem[];
}

export function ResourceList({ element }: ComponentRenderProps<ResourceListProps>) {
  const { items } = element.props;

  return (
    <>
      {items.map((item, i) => (
        <div key={i} className="palette-confirm-item">
          {item.status && <span className={`palette-dot palette-dot-${item.status}`} />}
          <span className="palette-confirm-name">{item.name}</span>
          {item.meta && <span className="palette-confirm-meta">{item.meta}</span>}
        </div>
      ))}
    </>
  );
}
