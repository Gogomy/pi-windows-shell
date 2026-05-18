/**
 * Persistent process registry for pi-windows-shell
 */

import fs from "node:fs";
import type { ProcessRegistry, ManagedProcess } from "./types.js";
import { getRegistryPath, ensureDir, getBaseDir } from "./paths.js";

const REGISTRY_VERSION = "1.0.0";

/**
 * Ensure the base directory exists.
 */
async function ensureBaseDir(): Promise<void> {
  await ensureDir(getBaseDir());
}

/**
 * Load the process registry from disk.
 */
export async function loadRegistry(): Promise<ProcessRegistry> {
  try {
    await ensureBaseDir();
    const path = getRegistryPath();
    
    try {
      await fs.promises.access(path);
    } catch {
      // File doesn't exist, return empty registry
      return { version: REGISTRY_VERSION, processes: [] };
    }

    const content = await fs.promises.readFile(path, "utf-8");
    const data = JSON.parse(content) as ProcessRegistry;
    
    // Validate version
    if (!data.version || !Array.isArray(data.processes)) {
      return { version: REGISTRY_VERSION, processes: [] };
    }

    return data;
  } catch (error) {
    console.error(`Failed to load registry: ${error}`);
    return { version: REGISTRY_VERSION, processes: [] };
  }
}

/**
 * Save the process registry to disk.
 */
export async function saveRegistry(registry: ProcessRegistry): Promise<void> {
  try {
    await ensureBaseDir();
    const path = getRegistryPath();
    await fs.promises.writeFile(path, JSON.stringify(registry, null, 2), "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to save registry: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Add a new process to the registry.
 */
export async function addProcess(process: ManagedProcess): Promise<void> {
  const registry = await loadRegistry();
  registry.processes.push(process);
  await saveRegistry(registry);
}

/**
 * Update a process in the registry.
 */
export async function updateProcess(id: string, updates: Partial<ManagedProcess>): Promise<boolean> {
  const registry = await loadRegistry();
  const index = registry.processes.findIndex((p) => p.id === id);
  
  if (index === -1) {
    return false;
  }

  registry.processes[index] = { ...registry.processes[index], ...updates };
  await saveRegistry(registry);
  return true;
}

/**
 * Remove a process from the registry.
 */
export async function removeProcess(id: string): Promise<boolean> {
  const registry = await loadRegistry();
  const initialLength = registry.processes.length;
  registry.processes = registry.processes.filter((p) => p.id !== id);
  
  if (registry.processes.length === initialLength) {
    return false;
  }

  await saveRegistry(registry);
  return true;
}

/**
 * Get a process by ID.
 */
export async function getProcess(id: string): Promise<ManagedProcess | null> {
  const registry = await loadRegistry();
  return registry.processes.find((p) => p.id === id) ?? null;
}

/**
 * Get all processes.
 */
export async function getAllProcesses(): Promise<ManagedProcess[]> {
  const registry = await loadRegistry();
  return registry.processes;
}

/**
 * Remove multiple processes by IDs.
 */
export async function removeProcesses(ids: string[]): Promise<number> {
  const registry = await loadRegistry();
  const initialLength = registry.processes.length;
  const idSet = new Set(ids);
  registry.processes = registry.processes.filter((p) => !idSet.has(p.id));
  
  const removed = initialLength - registry.processes.length;
  if (removed > 0) {
    await saveRegistry(registry);
  }
  return removed;
}

/**
 * Clean up stale registry entries.
 */
export async function cleanupRegistry(options: {
  removeExited?: boolean;
  deleteLogs?: boolean;
  olderThanDays?: number;
}): Promise<{
  removedEntries: number;
  deletedLogs: number;
  keptRunning: number;
}> {
  const registry = await loadRegistry();
  const toRemove: string[] = [];
  let deletedLogs = 0;

  // Handle log deletion
  if (options.deleteLogs && options.olderThanDays) {
    const olderThan = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000;
    
    for (const proc of registry.processes) {
      try {
        const stat = await fs.promises.stat(proc.outputFile);
        if (stat.mtimeMs < olderThan) {
          await fs.promises.unlink(proc.outputFile);
          deletedLogs++;
        }
      } catch {
        // File doesn't exist or can't be accessed, skip
      }
    }
  }

  // Handle registry entry removal
  if (options.removeExited) {
    for (const proc of registry.processes) {
      if (proc.status === "exited") {
        toRemove.push(proc.id);
      }
    }
  }

  const removedEntries = toRemove.length;
  if (removedEntries > 0) {
    await removeProcesses(toRemove);
  }

  // Count kept running processes, excluding those just removed
  const removedIds = new Set(toRemove);
  const remaining = registry.processes.filter(
    (p) => !removedIds.has(p.id) && p.status === "running"
  );
  
  return {
    removedEntries,
    deletedLogs,
    keptRunning: remaining.length,
  };
}

/**
 * Check if a process with given PID is still alive.
 * Returns the process status or null if not found.
 */
export async function checkProcessAlive(pid: number): Promise<"running" | "exited" | "unknown"> {
  try {
    // Try using Node's process kill check
    process.kill(pid, 0);
    return "running";
  } catch {
    // ESRCH means process doesn't exist
    // Other errors may mean permission issues
    return "exited";
  }
}