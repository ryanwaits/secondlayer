import { test, expect, describe } from "bun:test";
import { getView } from "../views/get-view.ts";
import { Views } from "../views/client.ts";
import { SecondLayer } from "../client.ts";

const mockSchema = {
  name: "test-view",
  schema: {
    transfers: {
      columns: {
        sender: { type: "principal" as const },
        amount: { type: "uint" as const },
      },
    },
    holders: {
      columns: {
        address: { type: "principal" as const },
      },
    },
  },
} as const;

describe("getView", () => {
  test("plain options object — returns client with schema table keys", () => {
    const client = getView(mockSchema, { apiKey: "sl_test" });
    expect(typeof client.transfers.findMany).toBe("function");
    expect(typeof client.transfers.count).toBe("function");
    expect(typeof client.holders.findMany).toBe("function");
  });

  test("SecondLayer instance — delegates to views.typed()", () => {
    const sl = new SecondLayer({ apiKey: "sl_test" });
    const client = getView(mockSchema, sl);
    expect(typeof client.transfers.findMany).toBe("function");
    expect(typeof client.holders.findMany).toBe("function");
  });

  test("Views instance — delegates to typed() directly", () => {
    const views = new Views({ apiKey: "sl_test" });
    const client = getView(mockSchema, views);
    expect(typeof client.transfers.findMany).toBe("function");
    expect(typeof client.holders.findMany).toBe("function");
  });

  test("no options — uses defaults", () => {
    const client = getView(mockSchema);
    expect(typeof client.transfers.findMany).toBe("function");
  });

  test("all three paths produce identical key sets", () => {
    const fromPlain = getView(mockSchema, {});
    const fromSL = getView(mockSchema, new SecondLayer({}));
    const fromViews = getView(mockSchema, new Views({}));
    const keys = Object.keys(mockSchema.schema).sort();
    expect(Object.keys(fromPlain).sort()).toEqual(keys);
    expect(Object.keys(fromSL).sort()).toEqual(keys);
    expect(Object.keys(fromViews).sort()).toEqual(keys);
  });
});
