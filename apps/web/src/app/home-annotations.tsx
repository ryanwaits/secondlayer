"use client";

export function HomeAnnotations() {
  return (
    <div className="prose">
      <p>
        Agent-native developer tools for Stacks.
      </p>
      <p>
        Atomic primitives that AI agents and developers compose to build
        on Stacks. Every tool is a CLI command, every command is an API call,
        every API call is a tool an agent can pick up and use in a loop.
      </p>
      <p>
        Open source. Self-host or use hosted. Built on{" "}
        <code>@secondlayer/stacks</code>, a viem-style SDK we dogfood across
        everything we ship.
      </p>
    </div>
  );
}
