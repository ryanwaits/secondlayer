import { homedir } from "node:os";
import { join } from "node:path";

const STREAMS_DIR = join(homedir(), ".secondlayer");
const DEV_STATE_PATH = join(STREAMS_DIR, "dev.json");
const LOGS_DIR = join(STREAMS_DIR, "logs");

export interface ServiceState {
  pid: number;
  port: number | null;
  startedAt: string;
  logFile: string;
}

export interface DevState {
  services: Record<string, ServiceState>;
  dockerContainers: {
    postgres: boolean;
  };
  env: {
    DATABASE_URL: string;
  };
  startedAt: string;
  node?: {
    network: string;
    installPath: string;
    startedAt: string;
  };
}

export function getLogsDir(): string {
  return LOGS_DIR;
}

export function getLogFile(service: string): string {
  return join(LOGS_DIR, `${service}.log`);
}

export async function ensureDirs(): Promise<void> {
  await Bun.$`mkdir -p ${STREAMS_DIR}`.quiet();
  await Bun.$`mkdir -p ${LOGS_DIR}`.quiet();
}

export async function loadDevState(): Promise<DevState | null> {
  const file = Bun.file(DEV_STATE_PATH);
  if (!(await file.exists())) {
    return null;
  }
  try {
    return await file.json();
  } catch {
    return null;
  }
}

export async function saveDevState(state: DevState): Promise<void> {
  await ensureDirs();
  await Bun.write(DEV_STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

export async function clearDevState(): Promise<void> {
  const file = Bun.file(DEV_STATE_PATH);
  if (await file.exists()) {
    await Bun.$`rm ${DEV_STATE_PATH}`.quiet();
  }
}

export async function clearLogs(): Promise<void> {
  await Bun.$`rm -f ${LOGS_DIR}/*.log`.quiet().nothrow();
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getRunningServices(): Promise<Record<string, ServiceState>> {
  const state = await loadDevState();
  if (!state) return {};

  const running: Record<string, ServiceState> = {};
  for (const [name, service] of Object.entries(state.services)) {
    if (isProcessRunning(service.pid)) {
      running[name] = service;
    }
  }
  return running;
}

export async function isDevRunning(): Promise<boolean> {
  const running = await getRunningServices();
  return Object.keys(running).length > 0;
}
