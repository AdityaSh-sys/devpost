# Blackout — Handoff Document

## Overview

**Blackout** is a "Connectivity Spectrum AI" — a Next.js PWA + FastAPI backend that provides AI assistance across three tiers of connectivity, designed for scenarios where internet access is unreliable or unavailable (disaster zones, remote areas, network outages).

## Architecture: Three Connectivity Modes

| Mode | Trigger | Technology | Implementation |
|------|---------|------------|----------------|
| **A — Online** | WiFi/4G detected, latency < 2s | Google Gemini 2.5 Flash Lite | Frontend calls `/api/chat` → proxies to FastAPI backend `/chat` → calls Gemini. Falls back to direct Gemini call if backend unreachable. Traced by Arize Phoenix. |
| **B — SMS Fallback** | No internet, has cellular | Twilio Programmable SMS | Frontend shows `sms:` deep link → user taps to send via native SMS app. Backend `/sms/webhook` receives SMS → calls Gemini → sends reply via Twilio. No API call from frontend. |
| **C — Offline AI** | No signal at all | Local IndexedDB knowledge base (36 entries) | TF-IDF vector matching with real embeddings computed at seed time. Keyword fallback for very low confidence. Voice input disabled. |

## Project Structure

```
Blackout/
├── backend/                 # FastAPI Python backend (deployable on Cloud Run)
│   ├── main.py              # All endpoints: /chat, /sms/send, /sms/webhook, /sync, /health, /ping
│   ├── Dockerfile           # Python 3.12-slim container
│   ├── requirements.txt     # FastAPI, httpx, motor (MongoDB), arize-phoenix (tracing)
│   └── .env                 # LIVE API keys — REVOKE THESE
├── frontend/                # Next.js 14 PWA with service worker
│   ├── public/
│   │   ├── manifest.json    # PWA manifest for installable app
│   │   ├── offline.html     # Offline fallback page (dark theme, purple accent)
│   │   └── *.svg            # Icons
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx       # Root layout + ServiceWorkerRegister component
│   │   │   ├── page.tsx         # Main page: sidebar + header + chat window + KB modal
│   │   │   ├── globals.css      # Dark theme glassmorphism UI, KB styles, SMS button styles
│   │   │   └── api/
│   │   │       ├── chat/route.ts         # Proxies to FastAPI /chat; falls back to direct Gemini call
│   │   │       ├── sms/send/route.ts     # Server-side SMS sender (Twilio) — not called by frontend in Mode B
│   │   │       ├── sms/webhook/route.ts  # Twilio webhook receiver (TwiML response)
│   │   │       ├── ping/route.ts         # HEAD/GET for latency measurement (runtime-cached by SW)
│   │   │       └── sync/
│   │   │           ├── conversations/route.ts  # MongoDB Atlas upsert with conflict detection
│   │   │           └── telemetry/route.ts      # MongoDB Atlas insert
│   │   ├── components/
│   │   │   ├── ServiceWorkerRegister.tsx  # Registers /sw.js in production
│   │   │   ├── ChatWindow.tsx            # Chat UI, voice input, "Open SMS App" button, offline mic disabled
│   │   │   ├── ConnectivityBanner.tsx    # Mode pill with degraded/captive portal warnings
│   │   │   ├── SyncIndicator.tsx         # Sync status with conflict count
│   │   │   ├── Sidebar.tsx              # History + settings (renamed "Manage Knowledge Base")
│   │   │   └── ModelDownloadModal.tsx   # KB management: add/delete entries, storage estimate
│   │   └── lib/
│   │       ├── connectivity.ts   # Hysteresis-based detection, captive portal check, degraded flag
│   │       ├── db.ts             # Dexie.js schema + 36-entry KB with real TF-IDF embeddings
│   │       ├── chat-engine.ts    # Mode routing: online→FastAPI, sms→deep link, offline→KB
│   │       ├── offline-ai.ts     # TF-IDF + cosine similarity, real embeddings from db.ts
│   │       └── sync.ts           # Sync engine with conflict array handling
│   ├── next.config.mjs           # next-pwa configured: dest:public, register, skipWaiting, runtimeCaching
│   └── .env.local                # API keys + MONGODB_URI + BACKEND_URL + NEXT_PUBLIC_TWILIO_PHONE_NUMBER
```

## Key Changes Applied

### Problem 1 — PWA is functional
- `next.config.mjs`: wrapped with `withPWA({ dest:'public', register:true, skipWaiting:true, disable:dev })`
- `runtimeCaching`: `/api/ping` with NetworkFirst, 5s timeout, 24h cache
- `public/offline.html`: dark theme, purple accent, "You're Offline" message with retry button
- `ServiceWorkerRegister.tsx`: registers `/sw.js` in production
- `layout.tsx`: includes ServiceWorkerRegister, removed broken apple-touch-icon reference

### Problem 2 — Connectivity detection is reliable
- `connectivity.ts`: two-phase check with hysteresis (2 consecutive failures to switch, 1 success to switch back)
- Latency thresholds: <2s online, 2-5s degraded (flag), >5s/timeout → offline
- Captive portal detection: after ping timeout, fetches `detectportal.firefox.com/success.txt`
- Exposed `degraded` and `captivePortal` on ConnectivityState
- `ConnectivityBanner.tsx`: shows "Slow Connection" / "Captive Portal" pills with dropdown warnings

### Problem 3 — SMS fallback uses deep link
- `chat-engine.ts` `querySMS()`: generates `sms:+[TWILIO_NUMBER]?body=[encoded query]`, shows "Open SMS App" button
- No API call from frontend in Mode B — works without internet
- Query stored in IndexedDB `offlineQueue` for later sync
- `/api/sms/send` route simplified to bare Twilio sender (server-side only)
- `ChatWindow.tsx`: renders `.sms-send-btn` anchor tag for `pendingSms` messages

### Problem 4 — Sync engine persists to MongoDB
- `/api/sync/conversations/route.ts`: upserts by `localId`, returns conflicts array with server versions
- `/api/sync/telemetry/route.ts`: inserts with `syncedAt` timestamp
- `sync.ts`: processes conflicts array, writes server versions back to IndexedDB, adds `SyncConflict` entries
- `SyncIndicator.tsx`: shows `conflicts` count in dropdown

### Problem 5 — Knowledge Base is honest and expanded
- `ModelDownloadModal.tsx`: renamed to "Offline Knowledge Base", removed fake Gemma/Phi-3 downloads
- KB management UI: add custom entries, delete entries, storage estimate
- `db.ts`: expanded from 8 to 36 entries across medical(12), survival(10), emergency(8), safety(6)
- TF-IDF vectors computed at seed time via `computeEmbedding()`, stored in `embedding` field
- `Sidebar.tsx`: renamed "Manage Offline Models" → "Manage Knowledge Base"

### Problem 6 — Gemini calls unified through FastAPI
- `/api/chat/route.ts`: proxies to FastAPI `/chat` first with `X-Session-Id` header; falls back to direct Gemini if backend unreachable
- `chat-engine.ts`: passes `X-Session-Id` header to `/api/chat`
- `.env.local`: added `BACKEND_URL=http://localhost:8000`, `NEXT_PUBLIC_BACKEND_URL`
- README updated with backend-first startup instructions

### Additional — Voice input in Mode C
- `ChatWindow.tsx`: mic button disabled when `currentMode === 'offline'`, tooltip: "Voice input unavailable offline"

## API Reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Proxies to FastAPI `/chat`; fallback to direct Gemini |
| `/api/sms/send` | POST | Server-side Twilio SMS sender |
| `/api/sms/webhook` | POST | Twilio inbound webhook (TwiML) |
| `/api/ping` | HEAD/GET | Latency check for connectivity engine |
| `/api/sync/conversations` | POST | MongoDB upsert with conflict detection |
| `/api/sync/telemetry` | POST | MongoDB telemetry insert |

## Security Concerns

1. **LIVE API KEYS COMMITTED** — Both `backend/.env` and `frontend/.env.local` contain valid credentials. **These should be revoked immediately.**
2. **CORS wide open** — `allow_origins=["*"]` on the FastAPI backend.
3. **No authentication** — No auth on any API endpoint.

## Tech Stack

**Frontend:** Next.js 14 (App Router), TypeScript, React 19, Dexie.js (IndexedDB), Tailwind CSS 4, Web Speech API, PWA (next-pwa)
**Backend:** FastAPI (Python 3.12), httpx, Motor (async MongoDB), Arize Phoenix (OTel tracing)
**Infrastructure:** Docker, Google Cloud Run (target), MongoDB Atlas, Twilio, Google Gemini API
