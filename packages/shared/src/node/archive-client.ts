/**
 * Archive Replay Client — backfills blocks from Hiro's daily event observer archive.
 *
 * The archive at archive.hiro.so contains zstd-compressed TSV files of raw
 * /new_block payloads (the exact NewBlockPayload JSON our indexer expects).
 * This client downloads the archive, streams + filters for specific block
 * heights, and POSTs matching payloads directly to the indexer.
 *
 * Zero external API dependency — only needs the static archive file.
 */

import { logger } from "../logger.ts";

const DEFAULT_ARCHIVE_URL =
  "https://archive.hiro.so/mainnet/stacks-blockchain-api/mainnet-stacks-blockchain-api-latest.zst";

const HEIGHT_REGEX = /"block_height":\s*(\d+)/;

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
    const archivePath = `${this.archiveDir}/secondlayer-archive.zst`;
    let replayed = 0;
    let errors = 0;

    logger.info("Archive replay: downloading archive", {
      url: this.archiveUrl.split("/").pop(),
      targetHeights: gapHeights.size,
      maxHeight,
    });

    try {
      // Download archive
      await this.download(archivePath);

      logger.info("Archive replay: download complete, starting decompression + replay");

      // Decompress via zstd subprocess
      const proc = Bun.spawn(["zstd", "-d", archivePath, "--stdout"], {
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
    } finally {
      // Clean up archive file
      try {
        const file = Bun.file(archivePath);
        if (await file.exists()) {
          await Bun.write(archivePath, ""); // truncate
          const { unlinkSync } = await import("node:fs");
          unlinkSync(archivePath);
        }
      } catch {
        // Best-effort cleanup
      }
    }

    return { replayed, errors };
  }

  /** Download archive to disk with streaming */
  private async download(destPath: string): Promise<void> {
    const res = await fetch(this.archiveUrl, {
      signal: AbortSignal.timeout(30 * 60 * 1000), // 30 min timeout
    });

    if (!res.ok || !res.body) {
      throw new Error(`Archive download failed: HTTP ${res.status}`);
    }

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
