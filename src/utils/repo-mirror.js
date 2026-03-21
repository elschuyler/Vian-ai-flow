// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Repo Mirror Utility
// ═══════════════════════════════════════════

const MIRROR = 'https://mirror-for-ai.vialewis31.workers.dev';
const INDEX_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Convert a GitHub or Codeberg URL to the correct fetch URL.
 * Returns { url, via } or null if unrecognised.
 */
export function resolveUrl(url) {
  const s = url.trim();

  // GitHub repo root
  let m = s.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/
  );
  if (m) return { url: `${MIRROR}/github/${m[1]}/${m[2]}/context`, via: 'mirror' };

  // GitHub file path
  m = s.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/blob\/([^/]+)\/(.+)$/
  );
  if (m) return {
    url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`,
    via: 'raw',
  };

  // Codeberg repo root
  m = s.match(
    /^https?:\/\/codeberg\.org\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/
  );
  if (m) return { url: `${MIRROR}/codeberg/${m[1]}/${m[2]}/context`, via: 'mirror' };

  // Codeberg file path
  m = s.match(
    /^https?:\/\/codeberg\.org\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/src\/branch\/([^/]+)\/(.+)$/
  );
  if (m) return { url: `${MIRROR}/codeberg/${m[1]}/${m[2]}/${m[4]}`, via: 'mirror' };

  return null;
}

/**
 * Legacy helper — kept for compatibility.
 */
export function toMirrorUrl(url) {
  const resolved = resolveUrl(url);
  return resolved ? resolved.url : null;
}

/**
 * Fetch content from a resolved URL. Returns plain text or throws.
 */
export async function fetchFromMirror(resolvedUrl) {
  const res = await fetch(resolvedUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Fetch returned HTTP ${res.status} for:\n${resolvedUrl}`);
  return res.text();
}

// ─── Line Range Fetch ─────────────────────────────────────────

/**
 * Resolve a file path (relative or absolute) to a raw fetch URL.
 * Uses the project's repoUrl to construct raw GitHub/Codeberg URLs.
 */
export function resolveFileUrl(filePath, repoUrl) {
  const p = filePath.trim();

  // Already a full GitHub blob URL — convert to raw
  let m = p.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;

  // Already a raw GitHub URL — use directly
  if (p.startsWith('https://raw.githubusercontent.com/')) return p;

  // Relative path — build from project repoUrl
  if (!repoUrl) return null;

  // GitHub repo URL
  m = repoUrl.match(/github\.com\/([^/\s]+)\/([^/\s]+)/);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/main/${p}`;

  // Codeberg repo URL
  m = repoUrl.match(/codeberg\.org\/([^/\s]+)\/([^/\s]+)/);
  if (m) return `${MIRROR}/codeberg/${m[1]}/${m[2]}/${p}`;

  return null;
}

/**
 * Fetch specific lines from a raw file URL.
 * Returns a string with line numbers prepended + total line count header.
 */
export async function fetchLineRange(rawUrl, start, end) {
  const res = await fetch(rawUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Fetch returned HTTP ${res.status}`);
  const text     = await res.text();
  const allLines = text.split('\n');
  const total    = allLines.length;
  const s        = Math.max(1, Number(start));
  const e        = Math.min(total, Number(end));
  const slice    = allLines.slice(s - 1, e);
  const numbered = slice.map((l, i) => `${s + i}: ${l}`).join('\n');
  return `Lines ${s}–${e} of ${total}:\n${numbered}`;
}

// ─── Repo Index Cache ─────────────────────────────────────────

function indexCacheKey(url) {
  return 'vian_index_' + url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
}

export function getCachedIndex(url) {
  try {
    const raw = localStorage.getItem(indexCacheKey(url));
    if (!raw) return null;
    const { data, cachedAt } = JSON.parse(raw);
    if (Date.now() - cachedAt > INDEX_CACHE_TTL) {
      localStorage.removeItem(indexCacheKey(url));
      return null;
    }
    return data;
  } catch { return null; }
}

export function setCachedIndex(url, data) {
  try {
    localStorage.setItem(indexCacheKey(url), JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {}
}

/**
 * Parse a mirror /context response to extract the file list.
 * Returns an array of file path strings.
 */
export function parseFileIndex(contextText) {
  const lines  = contextText.split('\n');
  const files  = [];
  let inList   = false;

  for (const line of lines) {
    if (line.startsWith('## All Files'))       { inList = true;  continue; }
    if (inList && line.startsWith('## '))       { inList = false; continue; }
    if (inList && line.trim() && !line.startsWith('#')) {
      files.push(line.trim());
    }
  }
  return files;
}
