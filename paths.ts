/**
 * Path helpers for pi-windows-shell
 */

import path from "node:path";
import os from "node:os";

/**
 * Get the base directory for pi-windows-shell data.
 * Uses LOCALAPPDATA, falls back to TEMP.
 */
export function getBaseDir(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    return path.join(localAppData, "pi-windows-shell");
  }
  return path.join(os.tmpdir(), "pi-windows-shell");
}

/**
 * Get the registry file path.
 */
export function getRegistryPath(): string {
  return path.join(getBaseDir(), "processes.json");
}

/**
 * Get the logs directory path.
 */
export function getLogsDir(): string {
  return path.join(getBaseDir(), "logs");
}

/**
 * Generate a default output file path for a new process.
 */
export function getDefaultOutputFile(name: string): string {
  const timestamp = Date.now().toString(36);
  const safeName = (name || "process")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 50);
  
  const logsDir = getLogsDir();
  return path.join(logsDir, `${timestamp}-${safeName}.log`);
}

/**
 * Ensure a directory exists, creating it if necessary.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dirPath, { recursive: true });
}

/**
 * Generate a unique process ID.
 */
export function generateProcessId(name: string): string {
  const timestamp = Date.now().toString(36);
  const safeName = (name || "process")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 20);
  return `${timestamp}-${safeName}`;
}

