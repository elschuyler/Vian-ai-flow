// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

// ═══════════════════════════════════════════
// VIAN AI FLOW — Repo Mirror Utility
//
// The AI sees GitHub/Codeberg URLs as-is and
// decides when to fetch via a [FETCH] block.
// The PWA intercepts that block, rewrites the
// URL to the mirror proxy, fetches the content,
// and injects it as a system message.
//
// Mirror base: mirror-for-ai.vialewis31.workers.dev
// ═══════════════════════════════════════════

const MIRROR = 'https://mirror-for-ai.vialewis31.workers.dev';

// Rewrite rules: repo URL → mirror context URL
// File/path URLs are also handled automatically
const RULES = [
  {
    // GitHub repo root: github.com/owner/repo
    re: /^https?:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/,
    toMirror: (m) => `${MIRROR}/github/${m[1]}/${m[2]}/context`,
  },
  {
    // GitHub file path: github.com/owner/repo/blob/branch/path
    re: /^https?:\/\/github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/blob\/[^/]+\/(.+)$/,
    toMirror: (m) => `${MIRROR}/github/${m[1]}/${m[2]}/${m[3]}`,
  },
  {
    // Codeberg repo root: codeberg.org/owner/repo
    re: /^https?:\/\/codeberg\.org\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/?$/,
    toMirror: (m) => `${MIRROR}/codeberg/${m[1]}/${m[2]}/context`,
  },
  {
    // Codeberg file path: codeberg.org/owner/repo/src/branch/branch/path
    re: /^https?:\/\/codeberg\.org\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\/src\/branch\/[^/]+\/(.+)$/,
    toMirror: (m) => `${MIRROR}/codeberg/${m[1]}/${m[2]}/${m[3]}`,
  },
];

/**
 * Convert a GitHub or Codeberg URL to its mirror equivalent.
 * Returns the mirror URL string, or null if no rule matched.
 */
export function toMirrorUrl(url) {
  const trimmed = url.trim();
  for (const rule of RULES) {
    const m = trimmed.match(rule.re);
    if (m) return rule.toMirror(m);
  }
  return null;
}

/**
 * Fetch content from the mirror proxy.
 * Returns plain-text string or throws an Error.
 */
export async function fetchFromMirror(mirrorUrl) {
  const res = await fetch(mirrorUrl, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`Mirror returned HTTP ${res.status} for:\n${mirrorUrl}`);
  }
  return res.text();
}
