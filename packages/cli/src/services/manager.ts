import type { Subprocess } from "bun";

export interface ServiceInfo {
  name: string;
  process: Subprocess;
  port: number | null;
  startedAt: Date;
}

export class ServiceManager {
  private services = new Map<string, ServiceInfo>();

  async start(
    name: string,
    command: string[],
    options: {
      port?: number;
      env?: Record<string, string>;
      cwd?: string;
      onStdout?: (line: string) => void;
      onStderr?: (line: string) => void;
    } = {}
  ): Promise<void> {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already running`);
    }

    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Handle stdout
    if (proc.stdout) {
      this.streamOutput(proc.stdout, options.onStdout);
    }

    // Handle stderr
    if (proc.stderr) {
      this.streamOutput(proc.stderr, options.onStderr);
    }

    this.services.set(name, {
      name,
      process: proc,
      port: options.port ?? null,
      startedAt: new Date(),
    });

    // Wait briefly to ensure process started
    await new Promise((r) => setTimeout(r, 100));

    // Check if process died immediately
    if (proc.exitCode !== null) {
      this.services.delete(name);
      throw new Error(`Service "${name}" failed to start (exit code: ${proc.exitCode})`);
    }
  }

  private async streamOutput(
    stream: ReadableStream<Uint8Array>,
    callback?: (line: string) => void
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() && callback) {
            callback(line);
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim() && callback) {
        callback(buffer);
      }
    } catch {
      // Stream closed
    }
  }

  async stop(name: string): Promise<void> {
    const service = this.services.get(name);
    if (!service) {
      return;
    }

    service.process.kill("SIGTERM");

    // Wait for graceful shutdown
    const timeout = setTimeout(() => {
      service.process.kill("SIGKILL");
    }, 5000);

    await service.process.exited;
    clearTimeout(timeout);

    this.services.delete(name);
  }

  async stopAll(): Promise<void> {
    const names = Array.from(this.services.keys());
    await Promise.all(names.map((name) => this.stop(name)));
  }

  isRunning(name: string): boolean {
    const service = this.services.get(name);
    if (!service) return false;
    return service.process.exitCode === null;
  }

  getPort(name: string): number | null {
    return this.services.get(name)?.port ?? null;
  }

  getService(name: string): ServiceInfo | undefined {
    return this.services.get(name);
  }

  listServices(): ServiceInfo[] {
    return Array.from(this.services.values());
  }
}

// Singleton instance
export const serviceManager = new ServiceManager();
