// Copyright (C) 2025 Schuyler [full name added later]
// SPDX-License-Identifier: AGPL-3.0-or-later

const CACHE_NAME = 'vian-ai-flow-v1';

// Never intercept calls to these hosts
const BYPASS_HOSTS = [
  'anthropic.com',
  'openai.com',
  'googleapis.com',
  'generativelanguage.googleapis.com',
  'deepseek.com',
  'api.deepseek.com',
  'mirror-for-ai.vialewis31.workers.dev',
  'cdnjs.cloudflare.com',
];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Pass through API calls and CDN scripts untouched
  if (BYPASS_HOSTS.some((h) => url.hostname.includes(h))) return;

  // Network-first for page navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Cache-first for all other assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        return response;
      });
    })
  );
});
