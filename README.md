# BLACKOUT

**Connectivity-Spectrum AI — Online, Offline, or Somewhere in Between.**

Blackout is an AI assistant that adapts to your connectivity. When online, it uses Gemini 2.0 Flash. When offline, it falls back to a local Gemma model (via Ollama) augmented with a knowledge base (RAG). Arize Phoenix provides observability across all modes.

## Architecture

| Mode | Condition | Stack |
|------|-----------|-------|
| **Online** | Internet available | Gemini 2.0 Flash API |
| **Offline** | No internet | Ollama (gemma2:2b) + MongoDB RAG |

- **Auto-detection** — Browser connectivity events + backend ping with adaptive polling (5s offline, 30s stable)
- **RAG** — Offline queries search a MongoDB knowledge base by keyword overlap; top results injected as context
- **KB Growth** — Thumbs-down feedback triggers Gemini to generate new Q&A pairs saved to the knowledge base
- **Sync Engine** — Queues offline messages/feedback and syncs when connectivity returns

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.12
- Ollama (for offline mode) — `ollama pull gemma2:2b`

### Frontend (Next.js)

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev        # → http://localhost:3000
```

### Backend (FastAPI)

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Add your API keys
uvicorn main:app --reload --port 8000
```

### First Visit

The app auto-detects Ollama and opens a setup wizard to download/verify the offline model (gemma2:2b). No setup needed for online mode.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google AI Studio API key |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `JWT_SECRET` | Yes | Secret for access tokens |
| `JWT_REFRESH_SECRET` | Yes | Secret for refresh tokens |
| `PHOENIX_API_KEY` | No | Arize Phoenix observability |
| `PHOENIX_COLLECTOR_ENDPOINT` | No | Phoenix trace collector URL |
| `OLLAMA_URL` | No | Default: `http://localhost:11434` |
| `KB_UPDATE_INTERVAL` | No | KB auto-update frequency (default: 10) |

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKEND_URL` | Yes | Backend API URL (e.g. `http://localhost:8000`) |

## Features

- **Adaptive Chat** — Dark glassmorphism UI with connectivity indicator
- **Online/Offline Auto-Detect** — Seamless mode switching with on-demand checks
- **Offline RAG** — Knowledge base retrieval augments local model answers
- **Model Setup Wizard** — First-visit flow for Ollama + gemma2:2b download
- **Auth** — JWT-based signup/login with token refresh
- **Session Sync** — Queued message/feedback sync when connectivity returns
- **Arize Phoenix Tracing** — Full span traces + quality evaluations for every query
- **Knowledge Base Management** — View/export KB entries from the Intelligence Hub

## Tech Stack

- **Frontend:** Next.js 14, TypeScript, Tailwind CSS
- **Backend:** FastAPI, Python 3.12, Motor (async MongoDB)
- **AI:** Google Gemini 2.0 Flash, Ollama (gemma2:2b)
- **Database:** MongoDB Atlas
- **Auth:** JWT (python-jose + bcrypt)
- **Observability:** Arize Phoenix (OpenTelemetry)
- **Deployment:** Frontend → Vercel, Backend → Railway

## Deployment

### Backend (Railway)

1. Push to GitHub
2. Create a Railway project from the repo
3. Set `backend/` as the root directory
4. Add all env vars from `backend/.env` as Railway secrets
5. Deploy — Railway auto-detects the Dockerfile

### Frontend (Vercel)

1. Push to GitHub
2. Import repo into Vercel
3. Set `frontend/` as the root directory
4. Add `BACKEND_URL` as a Vercel secret (linked to `NEXT_PUBLIC_BACKEND_URL`)
5. Deploy
