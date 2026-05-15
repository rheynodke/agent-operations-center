// File-manager style navigation for chat-outputs lists. The backend returns
// a flat list of `ChatOutputFile` with `relPath` like "reports/2026/q1.md";
// the UI now drills folder-by-folder instead of showing every file at once.

import type { ChatOutputFile } from "@/lib/chat-api"

export interface OutputFolderEntry {
  /** Folder name only (no trailing slash, no leading prefix). */
  name: string
  /** Absolute relative path including trailing slash, e.g. "reports/2026/". */
  fullPath: string
  /** Number of files at any depth under this folder. */
  fileCount: number
  /** Latest mtime among files under this folder. Used for sort ordering. */
  latestMtimeMs: number
}

export interface OutputTreeView {
  folders: OutputFolderEntry[]
  files: ChatOutputFile[]
}

/**
 * Compute the visible folders + files at `currentPath`.
 *
 * @param currentPath   "" for root, or a path WITH trailing slash (e.g. "reports/2026/")
 * @param stripPrefix   Optional path WITH trailing slash to remove from each
 *                      file's `relPath` before bucketing. Use this when the
 *                      backend wraps everything under a single root folder
 *                      ("outputs/"): pass `"outputs/"` and the UI's root view
 *                      shows the *contents* of outputs/ directly instead of a
 *                      single "outputs/" folder card.
 *
 * - Folders contain ALL descendants (recursive count + latest mtime), not just
 *   direct children — so a quick glance at the root tells you which subtree
 *   has activity.
 * - Files returned are only those at exactly `currentPath` depth (no nested).
 * - Folders sort by latest mtime desc (mirror "newest first" pattern), files
 *   by mtime desc.
 * - Files keep their ORIGINAL `relPath` (incl. any stripped prefix) so the
 *   caller can still use it for download/preview API calls.
 */
export function buildOutputTree(
  files: ChatOutputFile[],
  currentPath: string,
  stripPrefix = "",
): OutputTreeView {
  const folderMap = new Map<string, { latestMtimeMs: number; fileCount: number }>()
  const directFiles: ChatOutputFile[] = []

  for (const f of files) {
    // Compute the path used purely for tree placement; the file's stored
    // relPath stays intact for downstream API calls.
    const virtualPath = stripPrefix && f.relPath.startsWith(stripPrefix)
      ? f.relPath.slice(stripPrefix.length)
      : f.relPath
    if (!virtualPath.startsWith(currentPath)) continue
    const rest = virtualPath.slice(currentPath.length)
    const slashIdx = rest.indexOf("/")
    if (slashIdx === -1) {
      // File sits directly at currentPath
      directFiles.push(f)
    } else {
      // File is in a subfolder — bucket under the immediate child folder
      const folderName = rest.slice(0, slashIdx)
      const entry = folderMap.get(folderName) ?? { latestMtimeMs: 0, fileCount: 0 }
      entry.fileCount += 1
      if (f.mtimeMs > entry.latestMtimeMs) entry.latestMtimeMs = f.mtimeMs
      folderMap.set(folderName, entry)
    }
  }

  const folders: OutputFolderEntry[] = [...folderMap.entries()]
    .map(([name, info]) => ({
      name,
      fullPath: `${currentPath}${name}/`,
      fileCount: info.fileCount,
      latestMtimeMs: info.latestMtimeMs,
    }))
    .sort((a, b) => b.latestMtimeMs - a.latestMtimeMs)

  const sortedFiles = [...directFiles].sort((a, b) => b.mtimeMs - a.mtimeMs)

  return { folders, files: sortedFiles }
}

/**
 * Break a path like "reports/2026/q1/" into clickable breadcrumb segments.
 * Returns [] for empty/root path.
 */
export function splitBreadcrumb(currentPath: string): { name: string; fullPath: string }[] {
  if (!currentPath) return []
  const parts = currentPath.replace(/\/$/, "").split("/")
  const out: { name: string; fullPath: string }[] = []
  let acc = ""
  for (const p of parts) {
    acc += `${p}/`
    out.push({ name: p, fullPath: acc })
  }
  return out
}
