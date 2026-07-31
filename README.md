# Local Audio Transcript Sandbox

A local-first single-page application that transcribes audio through [Ollama](https://ollama.ai). No audio data or transcripts ever leave your machine.

## Prerequisites

- **Node.js** 24 LTS
- **Evergreen browser** (Chrome, Firefox, Safari — latest versions)
- **Ollama** v0.32+ (optional — required only for real transcription; the app works in demo/review mode without it)

## Install

```bash
npm install
npx playwright install
```

## Run locally

```bash
npm run dev
```

The app starts at `http://localhost:5173`. With Ollama running locally, it auto-detects the service and loads available models. Without Ollama, the connection panel shows clear recovery guidance.

## Automated validation

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript compiler errors |
| `npm run lint` | ESLint — strict rules, zero warnings |
| `npm run test` | Vitest — unit and component tests with jsdom |
| `npm run test:e2e` | Playwright — full browser scenarios against local dev server |
| `npm run build` | Production build |

## Privacy

- **Local-only:** All processing happens in your browser and Ollama instance. No data is uploaded to any remote service.
- **In-memory:** Audio files and transcripts exist only in browser memory. Nothing is written to disk, localStorage, sessionStorage, IndexedDB, Cache Storage, or cookies.
- **No cloud:** No telemetry, analytics, CDN runtime assets, or external API calls except to `http://localhost:11434` (your local Ollama).
- **No persistence:** Refreshing the page clears all state. Transcripts must be explicitly copied or downloaded before reload.

## Supported limits

| Limit | Value |
|---|---|
| Maximum file size | 25 MB |
| Maximum duration | 15 minutes |
| Segment length | 30 seconds |
| Segment overlap | 1 second |

## Recovery guidance

| Error | What to do |
|---|---|
| **Connection unavailable** | Verify Ollama is running (`ollama serve`). Check that `http://localhost:11434` is accessible and CORS/origin settings allow this page. Click "Retry connection". |
| **Model not found or incompatible** | Pull an audio-capable model (`ollama pull <model>`). Refresh the model list. |
| **Audio rejected** | Ensure the file is a decodable audio format (WAV, MP3, OGG, etc.), is under 25 MB, and is under 15 minutes. |
| **Transcription fails mid-way** | The transcript retains successfully transcribed segments. Click "Retry" to continue from the failed segment. |

## Optional Ollama smoke test

```bash
OLLAMA_SMOKE_MODEL=<model> npm run test:smoke
```

Requires a running Ollama instance with the specified model installed. Connects to Ollama, uploads a tiny WAV, and asserts non-empty transcript text. Skipped automatically when `OLLAMA_SMOKE_MODEL` is not set — never runs in ordinary CI.
