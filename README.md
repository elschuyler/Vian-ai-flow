# Vian AI Flow

https://elschuyler.github.io/Vian-ai-flow/

> Private offline-capable AI chat. Your keys. Your data. No accounts. No tracking.

Copyright (C) 2025 Schuyler [full name added later]  
License: [AGPL-3.0](./LICENSE)

---

## What it is

Vian AI Flow is a privacy-first AI chat PWA that runs entirely in your browser or as an Android APK. There is no backend, no accounts, no analytics, and no data leaves your device except the direct API calls you make to your chosen AI provider.

You bring your own API keys. Everything — chat history, context blocks, keys, settings — lives on your device only.

---

## Supported Providers

All providers are Bring-Your-Own-Key (BYOK).

| Provider | Models |
|---|---|
| Anthropic | Claude Sonnet 4, Claude Opus 4, Claude Haiku 4.5 |
| OpenAI | GPT-4o, GPT-4o Mini, o3-mini |
| Google | Gemini 2.0 Flash, Gemini 2.5 Pro |
| DeepSeek | DeepSeek V3, DeepSeek R1 |

All providers use real-time streaming responses. You can switch models mid-conversation — the full history carries over automatically.

---

## Features

- **Streaming responses** — text appears in real time as the AI generates it
- **Context Blocks** — named instruction sets that get silently prepended to every API call as a system prompt when active. Toggle them on/off per conversation
- **Repo Mirror Integration** — paste a GitHub or Codeberg URL in chat. The AI can emit a `[FETCH]` block to request repo content. The PWA fetches it via the mirror proxy and injects it as context automatically
- **ZIP Generation** — the AI can produce `[RUN]` blocks containing JSZip scripts. The PWA executes them in a sandboxed Web Worker with no access to your data, keys, or DOM. Downloads the ZIP automatically or shows a Run button depending on your settings
- **Code Blocks** — syntax-labeled, foldable, copyable, saveable as files
- **Token Counter** — every assistant message shows input tokens, output tokens, and estimated cost
- **Chat History** — all conversations saved to IndexedDB, searchable in the sidebar
- **Export** — download any conversation as a Markdown file
- **Offline capable** — Service Worker caches the app shell. API calls still require a connection
- **PWA installable** — add to home screen on Android
- **Android APK** — built automatically by CI via Capacitor

---

## Privacy

- No backend. Fully static.
- No accounts, no registration, no email.
- No telemetry, no analytics, no error reporting.
- API keys stored in `localStorage` on your device only.
- Keys go directly to the provider's API endpoint — no proxy, no relay.
- Chat history stored in `IndexedDB` on your device only.
- Nothing is shared between sessions unless you explicitly export.
- Clearing browser data removes everything.

---

## AI Script Sandbox

When the AI generates a `[RUN]` block, the script runs inside a Web Worker with a strictly limited scope. It has access to:

- A pre-initialised `JSZip` instance (`zip`)
- A `download(filename)` helper to trigger the browser save dialog

It does **not** have access to the DOM, `localStorage`, `IndexedDB`, API keys, chat history, or any variable outside the sandboxed scope.

---

## Repo Mirror

The mirror proxy at `mirror-for-ai.vialewis31.workers.dev` converts GitHub and Codeberg repo URLs into plain-text file listings the AI can read. When the AI emits:

```
[FETCH]
https://github.com/owner/repo
[/FETCH]
```

The PWA rewrites this to the mirror endpoint, fetches the repo context, and injects it as a follow-up system message. The AI can also request specific files using full file paths.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Vanilla JavaScript, HTML5, CSS3 |
| Build | Vite |
| Android Bridge | Capacitor |
| Persistence | IndexedDB (chats, context blocks), localStorage (keys, settings) |
| Markdown | Marked.js (CDN) |
| ZIP | JSZip (CDN) |
| PWA | Service Worker + Web Manifest |
| CI/CD | GitHub Actions |
| Hosting | GitHub Pages (PWA), GitHub Artifacts (APK) |

No framework. No React. No build step required to read or edit the source.

---

## Building

All builds happen in the cloud. You do not need Node.js, Android Studio, or Gradle installed locally.

Push to `main` → GitHub Actions automatically:
1. Installs dependencies
2. Builds the PWA with Vite
3. Adds the Android platform via Capacitor
4. Compiles the debug APK with Gradle
5. Deploys the PWA to GitHub Pages
6. Uploads the APK as a downloadable artifact

---

## Project Structure

```
vian-ai-flow/
├── .github/workflows/build.yml   ← CI/CD pipeline
├── public/
│   ├── manifest.json             ← PWA manifest
│   ├── sw.js                     ← Service Worker
│   └── icons/                    ← App icons (192, 512)
├── src/
│   ├── style.css                 ← All styles
│   ├── main.js                   ← App orchestrator
│   ├── api/
│   │   ├── index.js              ← Provider router
│   │   ├── anthropic.js
│   │   ├── openai.js
│   │   ├── google.js
│   │   └── deepseek.js
│   ├── db/
│   │   └── storage.js            ← IndexedDB + localStorage
│   ├── utils/
│   │   └── repo-mirror.js        ← Mirror URL rewriter + fetcher
│   └── workers/
│       └── sandbox.worker.js     ← JSZip execution sandbox
├── index.html
├── vite.config.js
├── capacitor.config.json
└── package.json
```

---

## Roadmap

- Compact `[H]` history format for token-efficient model switching
- Branching conversations — fork from any message, tree view in sidebar
- Additional AI providers (Mistral, Qwen, Groq, Ollama)
- Vian Code — sandboxed AI code editor with live PWA preview

---

## License

AGPL-3.0. See [LICENSE](./LICENSE).

If you want to use this in a commercial product, contact the author for a commercial license.
