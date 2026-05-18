/**
 * Output truncation and tail reading utilities
 */

import fs from "node:fs";
import { createReadStream } from "node:fs";
import type { TailResult } from "./types.js";

const DEFAULT_MAX_BYTES = 50000;
const DEFAULT_TAIL_LINES = 100;

/**
 * Read lines from the end of a file (tail functionality).
 */
export async function tailFile(
  filePath: string,
  options: {
    lines?: number;
    maxBytes?: number;
  } = {}
): Promise<TailResult> {
  const lines = options.lines ?? DEFAULT_TAIL_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  try {
    await fs.promises.access(filePath);
  } catch {
    return {
      lines: [],
      truncated: false,
      totalLines: 0,
      linesRead: 0,
      fileExists: false,
    };
  }

  try {
    const stats = await fs.promises.stat(filePath);
    const fileSize = stats.size;

    // If file is small enough, read it all
    if (fileSize <= maxBytes) {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const allLines = content.split(/\r?\n/).filter((l) => l.length > 0);
      const tailLines = allLines.slice(-lines);
      
      return {
        lines: tailLines,
        truncated: allLines.length > tailLines.length,
        totalLines: allLines.length,
        linesRead: tailLines.length,
        fileExists: true,
      };
    }

    // For large files, stream from the end
    const buffer = Buffer.alloc(maxBytes);
    const fd = await fs.promises.open(filePath, "r");
    
    try {
      // Read from near the end
      const startPos = Math.max(0, fileSize - maxBytes);
      const { bytesRead } = await fd.read(buffer, 0, maxBytes, startPos);
      const content = buffer.toString("utf-8", 0, bytesRead);
      
      // Split and find tail lines
      const allLines = content.split(/\r?\n/);
      
      // Skip partial first line if we started mid-line
      const skipPartial = startPos > 0 && !content.startsWith("\n") && !content.startsWith("\r");
      const lineStart = skipPartial ? 1 : 0;
      
      const totalLines = allLines.length - lineStart;
      const tailStartIndex = Math.max(lineStart, allLines.length - lines);
      const tailLines = allLines.slice(tailStartIndex);
      
      return {
        lines: tailLines,
        truncated: tailStartIndex > lineStart,
        totalLines,
        linesRead: tailLines.length,
        fileExists: true,
      };
    } finally {
      await fd.close();
    }
  } catch (error) {
    throw new Error(
      `Failed to read output file: ${filePath}. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Truncate output text to a maximum size.
 */
export function truncateOutput(
  text: string,
  options: {
    maxBytes?: number;
    maxLines?: number;
  } = {}
): { text: string; truncated: boolean } {
  const maxBytes = options.maxBytes ?? 50000;
  const maxLines = options.maxLines ?? 2000;

  // Check line limit
  const lines = text.split(/\r?\n/);
  if (lines.length > maxLines) {
    const truncatedLines = lines.slice(0, maxLines);
    return {
      text: truncatedLines.join("\n") + `\n[output truncated: showing first ${maxLines} lines of ${lines.length}]`,
      truncated: true,
    };
  }

  // Check byte limit
  if (Buffer.byteLength(text, "utf-8") > maxBytes) {
    let truncatedText = "";
    let currentBytes = 0;
    
    for (const line of lines) {
      const lineBytes = Buffer.byteLength(line + "\n", "utf-8");
      if (currentBytes + lineBytes > maxBytes) {
        break;
      }
      truncatedText += line + "\n";
      currentBytes += lineBytes;
    }
    
    return {
      text: truncatedText.trimEnd() + `\n[output truncated: ${Buffer.byteLength(text, "utf-8")} bytes down to ${maxBytes} bytes]`,
      truncated: true,
    };
  }

  return { text, truncated: false };
}

