import { z } from "zod";
import { schema } from "@json-render/react";

export const paletteCatalog = schema.createCatalog({
  components: {
    InfoPanel: {
      props: z.object({
        title: z.string(),
        markdown: z.string(),
        docUrl: z.string().optional(),
      }),
      description: "Renders a markdown info panel with optional doc link",
    },
    ConfirmCard: {
      props: z.object({
        title: z.string(),
        description: z.string().optional(),
        destructive: z.boolean().optional(),
      }),
      slots: ["default"],
      description: "Confirmation card with Execute/Cancel buttons. Put ResourceList, DetailSection inside.",
    },
    ResourceList: {
      props: z.object({
        items: z.array(z.object({
          name: z.string(),
          meta: z.string().optional(),
          status: z.enum(["green", "yellow", "red"]).optional(),
        })),
      }),
      description: "List of resources with status dots",
    },
    DetailSection: {
      props: z.object({
        label: z.string(),
        defaultOpen: z.boolean().optional(),
        badge: z.string().optional(),
      }),
      slots: ["default"],
      description: "Collapsible accordion section. Click to expand/collapse. Put KeyValueList inside.",
    },
    KeyValueList: {
      props: z.object({
        items: z.array(z.object({
          key: z.string(),
          value: z.string(),
          accent: z.boolean().optional(),
        })),
      }),
      description: "Key-value pairs displayed in rows. Use for filter configs, options, metadata.",
    },
    CodeBlock: {
      props: z.object({
        code: z.string(),
        lang: z.string().optional(),
        title: z.string().optional(),
      }),
      description: "Syntax-highlighted code block with copy button",
    },
  },
  actions: {
    execute: {
      params: z.object({}),
      description: "Execute the confirmed action",
    },
    cancel: {
      params: z.object({}),
      description: "Cancel and return to palette",
    },
  },
});

export type PaletteCatalog = typeof paletteCatalog;
