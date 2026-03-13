// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Repo Mirror Utility
//
// Two routing strategies:
//   Repo root URLs  → mirror proxy (/context endpoint)
//   Specific files  → raw.githubusercontent.com directly
//
// Mirror base: mirror-for-ai.vialewis31.workers.dev
// ═══════════════════════════════════════════

const MIRROR = 'https://mirror-for-ai.vialewis31.workers.dev';

/**
 * Convert a GitHub or Codeberg URL to the correct fetch URL.
 * - Repo roots use the mirror /context endpoint (structured overview)
 * - File paths use raw GitHub directly (no proxy needed, faster)
 * Returns { url, via } where via is 'mirror' or 'raw', or null if unrecognised.
 */
export function resolveUrl(url) {
  const s = url.trim();

  // ── GitHub repo root ──────────────────────────────────────
  let m = s.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/
  );
  if (m) return {
    url: `${MIRROR}/github/${m[1]}/${m[2]}/context`,
    via: 'mirror',
  };

  // ── GitHub file path ──────────────────────────────────────
  m = s.match(
    /^https?:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/blob\/([^/]+)\/(.+)$/
  );
  if (m) return {
    url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`,
    via: 'raw',
  };

  // ── Codeberg repo root ────────────────────────────────────
  m = s.match(
    /^https?:\/\/codeberg\.org\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/
  );
  if (m) return {
    url: `${MIRROR}/codeberg/${m[1]}/${m[2]}/context`,
    via: 'mirror',
  };

  // ── Codeberg file path ────────────────────────────────────
  m = s.match(
    /^https?:\/\/codeberg\.org\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/src\/branch\/([^/]+)\/(.+)$/
  );
  if (m) return {
    url: `${MIRROR}/codeberg/${m[1]}/${m[2]}/${m[4]}`,
    via: 'mirror', // Codeberg raw not as reliable, keep using mirror
  };

  return null;
}

/**
 * Legacy helper — returns mirror URL for repo roots only.
 * Kept for any code that still calls toMirrorUrl directly.
 * Prefer resolveUrl() for new code.
 */
export function toMirrorUrl(url) {
  const resolved = resolveUrl(url);
  return resolved ? resolved.url : null;
}

/**
 * Fetch content from a resolved URL.
 * Returns plain-text string or throws an Error.
 */
export async function fetchFromMirror(resolvedUrl) {
  const res = await fetch(resolvedUrl, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Fetch returned HTTP ${res.status} for:\n${resolvedUrl}`);
  }
  return res.text();
}
