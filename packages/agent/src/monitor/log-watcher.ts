import type { Subprocess } from "bun";
import type { PatternMatch } from "../types.ts";
import { matchPatterns } from "./patterns.ts";

interface WatcherProcess {
  service: string;
  container: string;
  proc: Subprocess;
  reconnectCount: number;
  lastConnectedAt: number;
}

export type MatchCallback = (match: PatternMatch) => void;

export class LogWatcher {
  private watchers: Map<string, WatcherProcess> = new Map();
  private running = false;
  private onMatch: MatchCallback;

  // Skip stacks-node (too verbose, RPC only)
  private static SKIP_CONTAINERS = ["secondlayer-stacks-node-1"];

  constructor(onMatch: MatchCallback) {
    this.onMatch = onMatch;
  }

  start(services: Array<{ name: string; container: string }>): void {
    this.running = true;

    for (const svc of services) {
      if (LogWatcher.SKIP_CONTAINERS.includes(svc.container)) continue;
      this.spawnWatcher(svc.name, svc.container);
    }
  }

  stop(): void {
    this.running = false;
    for (const [, w] of this.watchers) {
      w.proc.kill();
    }
    this.watchers.clear();
  }

  isHealthy(): boolean {
    if (!this.running) return false;
    const now = Date.now();
    for (const [, w] of this.watchers) {
      // Unhealthy if disconnected >60s
      if (now - w.lastConnectedAt > 60_000 && w.proc.exitCode !== null) {
        return false;
      }
    }
    return true;
  }

  getStatus(): Array<{ service: string; connected: boolean; reconnects: number }> {
    return [...this.watchers.entries()].map(([, w]) => ({
      service: w.service,
      connected: w.proc.exitCode === null,
      reconnects: w.reconnectCount,
    }));
  }

  private spawnWatcher(service: string, container: string): void {
    const proc = Bun.spawn(["docker", "logs", "--follow", "--since", "10s", container], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const watcher: WatcherProcess = {
      service,
      container,
      proc,
      reconnectCount: this.watchers.get(service)?.reconnectCount ?? 0,
      lastConnectedAt: Date.now(),
    };

    this.watchers.set(service, watcher);

    // Read stdout lines
    this.readLines(proc.stdout, service);
    // Also read stderr (docker logs outputs to stderr for some containers)
    this.readLines(proc.stderr, service);

    // Auto-reconnect on exit
    proc.exited.then(() => {
      if (!this.running) return;
      const w = this.watchers.get(service);
      if (w) w.reconnectCount++;

      // Respawn after 5s delay
      setTimeout(() => {
        if (this.running) this.spawnWatcher(service, container);
      }, 5_000);
    });
  }

  private async readLines(stream: ReadableStream<Uint8Array>, service: string): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const matches = matchPatterns(line, service);
          for (const m of matches) {
            this.onMatch(m);
          }
        }
      }
    } catch {
      // Stream closed — reconnect handles this
    }
  }
}
