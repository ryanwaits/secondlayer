import { Command } from "commander";
import { loadConfig, requireLocalNetwork } from "../lib/config.ts";
import { validateNetworkConsistency } from "../lib/network.ts";
import { startNodeContainers, isNodeRunning, stopNodeContainers } from "../lib/node-manager.ts";
import { isDevRunning } from "../lib/dev-state.ts";
import { requireDocker, DockerNotAvailableError } from "../lib/docker.ts";
import { error, success, warn, info, red, yellow, dim, blue } from "../lib/output.ts";

export function registerStackCommand(program: Command): void {
  const stack = program
    .command("stack")
    .description("Manage the full stack");

  stack
    .command("start")
    .description("Start the full stack (node + dev services)")
    .option("--no-node", "Skip starting the Stacks node")
    .option("--no-dev", "Skip starting dev services")
    .option("--network <network>", "Override network (mainnet|testnet)")
    .hook("preAction", async () => { await requireLocalNetwork(); })
    .action(async (options: { node: boolean; dev: boolean; network?: string }) => {
      await stackStart(options);
    });

  stack
    .command("stop")
    .description("Stop the full stack")
    .option("--no-node", "Skip stopping the Stacks node")
    .option("--no-dev", "Skip stopping dev services")
    .option("--wait", "Pause streams and drain queue before stopping")
    .hook("preAction", async () => { await requireLocalNetwork(); })
    .action(async (options: { node: boolean; dev: boolean; wait?: boolean }) => {
      await stackStop(options);
    });

  stack
    .command("restart")
    .description("Restart the full stack")
    .option("--no-node", "Skip restarting the Stacks node")
    .option("--no-dev", "Skip restarting dev services")
    .hook("preAction", async () => { await requireLocalNetwork(); })
    .action(async (options: { node: boolean; dev: boolean }) => {
      await stackStop({ ...options, wait: false });
      await stackStart(options);
    });
}

async function stackStart(options: { node: boolean; dev: boolean; network?: string }): Promise<void> {
  const config = await loadConfig();

  // Check Docker
  try {
    await requireDocker();
  } catch (err) {
    if (err instanceof DockerNotAvailableError) {
      error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const network = options.network ?? config.node?.network ?? "mainnet";

  // Validate network consistency
  const validation = await validateNetworkConsistency(config);
  if (!validation.valid) {
    error("Network mismatch detected:");
    for (const issue of validation.issues) {
      console.log(red(`  - ${issue}`));
    }
    console.log("");
    console.log(dim("Fix your config or stop mismatched containers first."));
    process.exit(1);
  }

  console.log("");
  console.log(blue("Starting Stacks Streams"));
  console.log(dim(`  Network: ${network}`));
  console.log("");

  // Start node
  if (options.node) {
    const nodePath = config.node?.installPath;
    if (!nodePath) {
      warn("No node configured, skipping. Run 'sl node setup' to configure.");
    } else if (await isNodeRunning()) {
      info("Node already running");
    } else {
      info("Starting Stacks node...");
      const started = await startNodeContainers(nodePath, network);
      if (!started) {
        error("Failed to start node containers");
        process.exit(1);
      }
      success("Node containers started");

      // Poll RPC until responsive
      info("Waiting for node RPC...");
      let rpcReady = false;
      for (let i = 0; i < 60; i++) {
        try {
          const res = await fetch("http://localhost:20443/v2/info", {
            signal: AbortSignal.timeout(2000),
          });
          if (res.ok) {
            rpcReady = true;
            break;
          }
        } catch {}
        await Bun.sleep(1000);
      }

      if (rpcReady) {
        success("Node RPC responsive");
        // Post-start chain ID validation
        const postValidation = await validateNetworkConsistency(config);
        if (!postValidation.valid) {
          warn("Post-start chain ID mismatch:");
          for (const issue of postValidation.issues) {
            console.log(yellow(`  - ${issue}`));
          }
        }
      } else {
        warn("Node RPC not responsive after 60s (may still be starting)");
      }
    }
    console.log("");
  }

  // Start dev services
  if (options.dev) {
    if (await isDevRunning()) {
      info("Dev services already running");
    } else {
      // Delegate to `streams dev start` via subprocess
      const args = ["bun", "run", import.meta.dir + "/../../bin/secondlayer.ts", "dev", "start"];
      if (config.node?.installPath) {
        args.push("--stacks-node");
      }
      info("Starting dev services...");
      const proc = Bun.spawn(args, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    }
  }

  console.log("");
  success("Stack started");
  console.log(dim("Run 'sl status' to check health"));
  console.log("");
}

async function stackStop(options: { node: boolean; dev: boolean; wait?: boolean }): Promise<void> {
  console.log("");
  info("Stopping Stacks Streams...");

  // Pause and wait if requested
  if (options.wait) {
    try {
      const { pauseAllStreams, getQueueStats } = await import("../lib/api-client.ts");
      info("Pausing streams...");
      await pauseAllStreams();

      process.stdout.write(dim("Waiting for jobs to complete..."));
      for (let i = 0; i < 300; i++) {
        const stats = await getQueueStats();
        const active = stats.pending + stats.processing;
        if (active === 0) {
          process.stdout.write("\n");
          success("Queue drained");
          break;
        }
        process.stdout.write(`\r${dim(`Waiting for jobs... ${active} remaining`)}`);
        await Bun.sleep(1000);
      }
    } catch {
      warn("Could not pause streams (API may not be running)");
    }
    console.log("");
  }

  // Stop dev services
  if (options.dev) {
    if (await isDevRunning()) {
      info("Stopping dev services...");
      const proc = Bun.spawn(
        ["bun", "run", import.meta.dir + "/../../bin/secondlayer.ts", "dev", "stop"],
        { stdin: "inherit", stdout: "inherit", stderr: "inherit" }
      );
      await proc.exited;
    } else {
      info("Dev services not running");
    }
  }

  // Stop node
  if (options.node) {
    if (await isNodeRunning()) {
      info("Stopping node containers...");
      const stopped = await stopNodeContainers();
      if (stopped.length > 0) {
        success(`Stopped: ${stopped.join(", ")}`);
      }
    } else {
      info("Node not running");
    }
  }

  // Orphaned container cleanup
  try {
    const result = await Bun.$`docker ps -a --format json --filter "name=streams-dev" --filter "name=stacks"`.quiet().nothrow();
    if (result.exitCode === 0) {
      const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
      const orphans: string[] = [];
      for (const line of lines) {
        try {
          const c = JSON.parse(line);
          const name = c.Names || c.Name;
          if (name && c.Status?.includes("Exited")) {
            orphans.push(name);
          }
        } catch {}
      }
      if (orphans.length > 0) {
        info(`Cleaning up ${orphans.length} orphaned container(s)...`);
        for (const name of orphans) {
          await Bun.$`docker rm ${name}`.quiet().nothrow();
        }
      }
    }
  } catch {}

  console.log("");
  success("Stack stopped");
  console.log("");
}
