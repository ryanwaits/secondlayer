import { getEnv } from "./env.ts";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private _level?: LogLevel;
  private _isProduction?: boolean;
  private _initialized = false;

  private init() {
    if (this._initialized) return;
    this._initialized = true;
    try {
      const env = getEnv();
      this._level = env.LOG_LEVEL;
      this._isProduction = env.NODE_ENV === "production";
    } catch {
      // Fallback when env is unavailable (e.g. tests without DATABASE_URL)
      this._level = "info";
      this._isProduction = false;
    }
  }

  private get level(): LogLevel {
    this.init();
    return this._level!;
  }

  private get isProduction(): boolean {
    this.init();
    return this._isProduction!;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, any>) {
    const timestamp = new Date().toISOString();

    if (this.isProduction) {
      // JSON output for production
      return JSON.stringify({
        timestamp,
        level,
        message,
        ...meta,
      });
    }

    // Human-readable output for development
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
  }

  debug(message: string, meta?: Record<string, any>) {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, meta));
    }
  }

  info(message: string, meta?: Record<string, any>) {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, meta));
    }
  }

  warn(message: string, meta?: Record<string, any>) {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, meta));
    }
  }

  error(message: string, meta?: Record<string, any>) {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, meta));
    }
  }
}

// Export singleton instance
export const logger: Logger = new Logger();
