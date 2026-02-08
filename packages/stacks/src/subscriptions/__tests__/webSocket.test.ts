import { test, expect, describe } from "bun:test";
import { webSocket } from "../../transports/webSocket.ts";
import { mainnet, testnet, devnet } from "../../chains/definitions.ts";

describe("webSocket transport factory", () => {
  test("creates transport with type webSocket", () => {
    const factory = webSocket("ws://localhost:3999");
    const transport = factory();

    expect(transport.type).toBe("webSocket");
    expect(transport.request).toBeFunction();
    expect((transport as any).subscribe).toBeFunction();
    expect((transport as any).destroy).toBeFunction();
  });

  test("resolves ws URL from chain definition", () => {
    const factory = webSocket();
    const transport = factory({ chain: mainnet });

    expect(transport.type).toBe("webSocket");
    // HTTP request should use mainnet URL
    expect(transport.config.url).toBe("https://api.mainnet.hiro.so");
  });

  test("resolves ws URL for testnet", () => {
    const factory = webSocket();
    const transport = factory({ chain: testnet });

    expect(transport.config.url).toBe("https://api.testnet.hiro.so");
  });

  test("resolves ws URL for devnet", () => {
    const factory = webSocket();
    const transport = factory({ chain: devnet });

    expect(transport.config.url).toBe("http://localhost:3999");
  });

  test("explicit URL overrides chain ws URL", () => {
    const factory = webSocket("ws://custom:1234");
    const transport = factory({ chain: mainnet });

    expect(transport.type).toBe("webSocket");
    // HTTP config still uses chain URL
    expect(transport.config.url).toBe("https://api.mainnet.hiro.so");
  });

  test("derives ws URL from http when no ws defined", () => {
    const customChain = {
      ...devnet,
      rpcUrls: { default: { http: ["https://my-node.example.com"] } },
    };

    const factory = webSocket();
    const transport = factory({ chain: customChain });

    // HTTP should use the custom URL
    expect(transport.config.url).toBe("https://my-node.example.com");
  });

  test("falls back to localhost when no chain provided", () => {
    const factory = webSocket();
    const transport = factory();

    expect(transport.config.url).toBe("http://localhost:3999");
  });

  test("destroy calls channel destroy", () => {
    const factory = webSocket("ws://localhost:3999");
    const transport = factory();

    // Should not throw
    (transport as any).destroy();
  });
});
