# 🌑 BLACKOUT

**AI That Works Everywhere — Online, via SMS, or Completely Offline.**

Blackout is a **Connectivity Spectrum AI** application that intelligently routes queries across three connectivity modes, ensuring you never lose access to AI assistance.

## 🏗 Architecture

| Mode | Condition | Technology |
|------|-----------|------------|
| **Mode A: Full Online** | WiFi/4G | Gemini 2.0 Flash API |
| **Mode B: SMS Fallback** | No internet, has cellular | Twilio SMS → Cloud → SMS Reply |
| **Mode C: Offline AI** | No signal | Local knowledge base + vector retrieval |

## 🚀 Quick Start

### Backend (FastAPI) — must be running first
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The frontend proxies Mode A (Online) chat calls through this backend for Arize Phoenix observability. If the backend is unreachable, the frontend falls back to calling Gemini directly.

### Frontend (Next.js PWA)
```bash
cd frontend
cp .env.local.example .env.local  # Add your API keys
npm install
npm run dev
```

## 🔑 API Keys Needed

| Service | Purpose | Get It |
|---------|---------|--------|
| Gemini API | Online AI | [Google AI Studio](https://aistudio.google.com/) |
| Twilio | SMS Transport | [Twilio Console](https://console.twilio.com/) |
| MongoDB Atlas | Cloud Database | [MongoDB Atlas](https://cloud.mongodb.com/) |

> **Note:** The app works in demo mode without any API keys!

## 📱 Features

- **Adaptive Chat UI** — Beautiful dark theme with glassmorphism
- **Voice Input** — Speech-to-text for hands-free queries
- **Offline Knowledge Base** — Emergency, medical, and survival information
- **Sync Engine** — Automatic data sync when connectivity returns
- **PWA** — Install as a native-like app on any device
- **Demo Mode** — Switch between connectivity modes to test behavior

## 🏛 Tech Stack

- **Frontend:** Next.js 14+, TypeScript, Dexie.js (IndexedDB)
- **Backend:** FastAPI, Python 3.12
- **AI:** Google Gemini 2.0 Flash, Local Vector Search
- **SMS:** Twilio Programmable SMS
- **Database:** MongoDB Atlas
- **Observability:** Arize Phoenix
- **Deployment:** Google Cloud Run, Docker

## 📄 License

MIT
