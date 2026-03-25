/**
 * Archive Replay Client — backfills blocks from Hiro's daily event observer archive.
 *
 * The archive at archive.hiro.so contains zstd-compressed TSV files of raw
 * /new_block payloads (the exact NewBlockPayload JSON our indexer expects).
 * This client downloads the archive, streams + filters for specific block
 * heights, and POSTs matching payloads directly to the indexer.
 *
 * Caches the archive locally for up to 24h to avoid redundant ~25GB downloads.
 * Zero external API dependency — only needs the static archive file.
 */

import { logger } from "../logger.ts";
import { existsSync, unlinkSync, renameSync, readFileSync, writeFileSync } from "node:fs";

const DEFAULT_ARCHIVE_URL =
  "https://archive.hiro.so/mainnet/stacks-blockchain-api/mainnet-stacks-blockchain-api-latest.zst";

const HEIGHT_REGEX = /"block_height":\s*(\d+)/;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

interface ArchiveMeta {
  lastModified: string | null;
  downloadedAt: string;
}

export interface ReplayResult {
  replayed: number;
  errors: number;
}

export interface ReplayOptions {
  onProgress?: (count: number, height: number) => void;
}

export class ArchiveReplayClient {
  private archiveUrl: string;
  private archiveDir: string;

  constructor(opts?: { archiveUrl?: string; archiveDir?: string }) {
    this.archiveUrl = opts?.archiveUrl || process.env.ARCHIVE_URL || DEFAULT_ARCHIVE_URL;
    this.archiveDir = opts?.archiveDir || process.env.ARCHIVE_DIR || "/tmp";
  }

  private get archivePath() {
    return `${this.archiveDir}/secondlayer-archive.zst`;
  }
  private get metaPath() {
    return `${this.archiveDir}/secondlayer-archive.meta.json`;
  }
  private get partialPath() {
    return `${this.archiveDir}/secondlayer-archive.zst.partial`;
  }

  /** HEAD request to archive URL — verify reachable and has content */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(this.archiveUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(15_000),
      });
      const contentLength = Number(res.headers.get("content-length") || 0);
      return res.ok && contentLength > 0;
    } catch {
      return false;
    }
  }

  /**
   * Download archive, stream-decompress, replay blocks matching gapHeights
   * to the indexer's /new_block endpoint.
   */
  async replayGaps(
    gapHeights: Set<number>,
    indexerUrl: string,
    opts?: ReplayOptions,
  ): Promise<ReplayResult> {
    if (gapHeights.size === 0) return { replayed: 0, errors: 0 };

    const maxHeight = Math.max(...gapHeights);
    let replayed = 0;
    let errors = 0;

    try {
      await this.ensureArchive();

      logger.info("Archive replay: starting decompression + replay", {
        targetHeights: gapHeights.size,
        maxHeight,
      });

      // Decompress via zstd subprocess
      const proc = Bun.spawn(["zstd", "-d", this.archivePath, "--stdout"], {
        stdout: "pipe",
        stderr: "ignore",
      });

      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const remaining = new Set(gapHeights);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (remaining.size === 0) break;

          // Quick height check via regex (avoid full JSON parse)
          const match = HEIGHT_REGEX.exec(line);
          if (!match) continue;

          const height = parseInt(match[1]);

          // Skip blocks we don't need
          if (!remaining.has(height)) {
            // Early exit if past all gap heights
            if (height > maxHeight) break;
            continue;
          }

          // Extract payload from TSV (id \t timestamp \t path \t payload)
          const tabIdx3 = nthIndex(line, "\t", 3);
          if (tabIdx3 === -1) continue;

          const path = line.substring(nthIndex(line, "\t", 2) + 1, tabIdx3);
          if (path !== "/new_block") continue;

          const payload = line.substring(tabIdx3 + 1);

          try {
            const res = await fetch(`${indexerUrl}/new_block`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Source": "archive-replay",
              },
              body: payload,
            });

            if (res.ok) {
              replayed++;
              remaining.delete(height);
              opts?.onProgress?.(replayed, height);
            } else {
              errors++;
              logger.warn("Archive replay: indexer rejected block", { height, status: res.status });
            }
          } catch (err) {
            errors++;
            logger.warn("Archive replay: POST failed", { height, error: String(err) });
          }
        }

        // Early exit if all gaps filled or past max height
        if (remaining.size === 0) {
          proc.kill();
          break;
        }
      }

      // Wait for process to exit
      await proc.exited;

      if (remaining.size > 0) {
        logger.warn("Archive replay: some heights not found in archive", {
          missing: remaining.size,
          sample: [...remaining].slice(0, 5),
        });
      }

      logger.info("Archive replay: complete", { replayed, errors, missing: remaining.size });
    } catch (err) {
      // Clean up on error (corrupt/partial downloads)
      this.cleanupFile(this.archivePath);
      this.cleanupFile(this.metaPath);
      this.cleanupFile(this.partialPath);
      throw err;
    }

    return { replayed, errors };
  }

  /**
   * Ensure a fresh-enough archive exists locally.
   * Uses HTTP conditional requests to avoid redundant downloads.
   */
  private async ensureArchive(): Promise<void> {
    this.cleanStaleFiles();

    const meta = this.readMeta();
    const cached = existsSync(this.archivePath) && meta !== null;

    if (cached) {
      const age = Date.now() - new Date(meta.downloadedAt).getTime();
      if (age < CACHE_MAX_AGE_MS) {
        // Cache is fresh enough — check if remote has a newer version
        const headers: Record<string, string> = {};
        if (meta.lastModified) {
          headers["If-Modified-Since"] = meta.lastModified;
        }

        try {
          const res = await fetch(this.archiveUrl, {
            method: "HEAD",
            headers,
            signal: AbortSignal.timeout(15_000),
          });

          if (res.status === 304) {
            logger.info("Archive replay: using cached archive", {
              ageHrs: (age / 3600000).toFixed(1),
            });
            return;
          }

          // 200 = remote is newer, re-download below
          logger.info("Archive replay: remote archive is newer, re-downloading");
        } catch {
          // Can't reach remote — use cache anyway
          logger.info("Archive replay: remote unreachable, using cached archive");
          return;
        }
      } else {
        logger.info("Archive replay: cache expired, re-downloading");
      }
    }

    // Download fresh archive
    logger.info("Archive replay: downloading archive", {
      url: this.archiveUrl.split("/").pop(),
    });

    const lastModified = await this.download(this.partialPath);

    // Atomic rename: partial → final
    renameSync(this.partialPath, this.archivePath);

    // Write meta sidecar
    this.writeMeta({ lastModified, downloadedAt: new Date().toISOString() });

    logger.info("Archive replay: download complete");
  }

  /** Remove stale cache (> 24h) and orphaned partial files */
  private cleanStaleFiles(): void {
    try {
      // Clean orphaned partial downloads
      if (existsSync(this.partialPath)) {
        unlinkSync(this.partialPath);
      }

      // Clean stale cache
      const meta = this.readMeta();
      if (meta) {
        const age = Date.now() - new Date(meta.downloadedAt).getTime();
        if (age > CACHE_MAX_AGE_MS) {
          this.cleanupFile(this.archivePath);
          this.cleanupFile(this.metaPath);
          logger.info("Archive replay: cleaned stale cache");
        }
      } else if (existsSync(this.archivePath)) {
        // Archive without meta — orphaned, clean up
        this.cleanupFile(this.archivePath);
      }
    } catch {
      // Best-effort cleanup
    }
  }

  private readMeta(): ArchiveMeta | null {
    try {
      if (!existsSync(this.metaPath)) return null;
      return JSON.parse(readFileSync(this.metaPath, "utf-8")) as ArchiveMeta;
    } catch {
      return null;
    }
  }

  private writeMeta(meta: ArchiveMeta): void {
    try {
      writeFileSync(this.metaPath, JSON.stringify(meta));
    } catch {
      // Best-effort
    }
  }

  private cleanupFile(path: string): void {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // Best-effort
    }
  }

  /** Download archive to disk with streaming. Returns Last-Modified header. */
  private async download(destPath: string): Promise<string | null> {
    const res = await fetch(this.archiveUrl, {
      signal: AbortSignal.timeout(30 * 60 * 1000), // 30 min timeout
    });

    if (!res.ok || !res.body) {
      throw new Error(`Archive download failed: HTTP ${res.status}`);
    }

    const lastModified = res.headers.get("last-modified");
    const totalBytes = Number(res.headers.get("content-length") || 0);
    const writer = Bun.file(destPath).writer();
    let downloaded = 0;
    let lastLog = 0;

    for await (const chunk of res.body) {
      writer.write(chunk);
      downloaded += chunk.byteLength;

      // Log progress every 5GB
      if (totalBytes > 0 && downloaded - lastLog > 5_000_000_000) {
        lastLog = downloaded;
        const pct = ((downloaded / totalBytes) * 100).toFixed(0);
        logger.info("Archive replay: downloading", { progress: `${pct}%` });
      }
    }

    await writer.end();
    return lastModified;
  }
}

/** Find the nth occurrence of a character in a string */
function nthIndex(str: string, char: string, n: number): number {
  let idx = -1;
  for (let i = 0; i < n; i++) {
    idx = str.indexOf(char, idx + 1);
    if (idx === -1) return -1;
  }
  return idx;
}
