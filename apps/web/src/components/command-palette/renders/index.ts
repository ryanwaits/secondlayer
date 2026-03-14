import { createRenderer } from "@json-render/react";
import { paletteCatalog } from "@/lib/command/catalog";
import { InfoPanel } from "./info-panel";
import { ConfirmCard } from "./confirm-card";
import { ResourceList } from "./resource-list";
import { DetailSection } from "./detail-section";
import { KeyValueList } from "./key-value-list";
import { CodeBlock } from "./code-block";

export const PaletteRenderer = createRenderer(paletteCatalog, {
  InfoPanel,
  ConfirmCard,
  ResourceList,
  DetailSection,
  KeyValueList,
  CodeBlock,
});
