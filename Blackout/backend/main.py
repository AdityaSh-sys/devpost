"""
Blackout Backend - FastAPI Application
Handles: Gemini API, Twilio SMS, MongoDB Atlas, Arize Phoenix
"""
import os
import time
import base64
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Initialize FastAPI
app = FastAPI(
    title="Blackout API",
    description="Backend for Blackout - Connectivity Spectrum AI",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ Models ============

class ChatRequest(BaseModel):
    query: str
    history: list[dict] = []

class ChatResponse(BaseModel):
    response: str
    model: str
    latency_ms: int

class SMSRequest(BaseModel):
    query: str
    phone_number: Optional[str] = None

class SyncRequest(BaseModel):
    conversations: list[dict] = []
    telemetry: list[dict] = []

# ============ Configuration ============

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "")
SMS_RECIPIENT = os.getenv("SMS_RECIPIENT", "")
MONGODB_URI = os.getenv("MONGODB_URI", "")
PHOENIX_API_KEY = os.getenv("PHOENIX_API_KEY", "")

# ============ MongoDB Client (lazy init) ============

_mongo_client = None
_mongo_db = None

def get_mongo_db():
    global _mongo_client, _mongo_db
    if _mongo_db is None and MONGODB_URI:
        from motor.motor_asyncio import AsyncIOMotorClient
        _mongo_client = AsyncIOMotorClient(MONGODB_URI)
        _mongo_db = _mongo_client.blackout
    return _mongo_db

# ============ Arize Phoenix (lazy init) ============

def init_phoenix():
    """Initialize Arize Phoenix for observability tracing."""
    if not PHOENIX_API_KEY:
        return None
    try:
        from phoenix.otel import register

        tracer_provider = register(
            project_name="blackout",
            endpoint=os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "https://app.phoenix.arize.com/v1/traces"),
            headers={"api_key": PHOENIX_API_KEY},
        )
        return tracer_provider
    except ImportError:
        print("Phoenix not installed. Run: pip install arize-phoenix-otel openinference-instrumentation")
        return None

# Initialize Phoenix on startup
tracer_provider = init_phoenix()

# ============ Health Check ============

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "gemini": bool(GEMINI_API_KEY),
            "twilio": bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN),
            "mongodb": bool(MONGODB_URI),
            "phoenix": bool(PHOENIX_API_KEY),
        },
    }

@app.head("/ping")
@app.get("/ping")
async def ping():
    return {"status": "ok", "timestamp": time.time()}

# ============ Chat Endpoint ============

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    start = time.time()

    if not GEMINI_API_KEY:
        return ChatResponse(
            response="Blackout API is running in demo mode. Set GEMINI_API_KEY for full functionality.",
            model="Demo",
            latency_ms=int((time.time() - start) * 1000),
        )

    try:
        import httpx

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={GEMINI_API_KEY}"

        contents = [
            {"role": "user", "parts": [{"text": "You are Blackout AI, a helpful assistant that works across all connectivity modes."}]},
            {"role": "model", "parts": [{"text": "Understood. I'm Blackout AI, ready to help."}]},
        ]

        for msg in request.history[-10:]:
            role = "model" if msg.get("role") == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]})

        contents.append({"role": "user", "parts": [{"text": request.query}]})

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json={
                "contents": contents,
                "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
            })
            resp.raise_for_status()
            data = resp.json()

        text = data["candidates"][0]["content"]["parts"][0]["text"]
        latency = int((time.time() - start) * 1000)

        # Store to MongoDB if connected
        db = get_mongo_db()
        if db:
            await db.conversations.insert_one({
                "query": request.query,
                "response": text,
                "connectivity_state": "online",
                "model_used": "Gemini 2.5 Flash Lite",
                "latency_ms": latency,
                "timestamp": datetime.utcnow(),
            })

        return ChatResponse(response=text, model="Gemini 2.5 Flash Lite", latency_ms=latency)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============ Twilio SMS Endpoints ============

@app.post("/sms/send")
async def send_sms(request: SMSRequest):
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        return {"status": "demo", "message": "Twilio not configured", "query": request.query}

    try:
        import httpx

        url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
        auth_b64 = base64.b64encode(f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode()).decode()

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Basic {auth_b64}"},
                data={
                    "To": request.phone_number or SMS_RECIPIENT,
                    "From": TWILIO_PHONE_NUMBER,
                    "Body": f"BLACKOUT: {request.query[:140]}",
                },
            )
            resp.raise_for_status()
            result = resp.json()

        # Store to MongoDB
        db = get_mongo_db()
        if db:
            await db.telemetry.insert_one({
                "event_type": "sms_sent",
                "data": {"recipient": request.phone_number or SMS_RECIPIENT, "sid": result.get("sid")},
                "timestamp": datetime.utcnow(),
            })

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sms/webhook")
async def sms_webhook(request: Request):
    """Twilio webhook — receives incoming SMS via TwiML."""
    form = await request.form()
    body = form.get("Body", "")
    from_number = form.get("From", "")
    message_sid = form.get("MessageSid", "")

    print(f"Incoming SMS from {from_number}: {body} (SID: {message_sid})")

    # Store to MongoDB
    db = get_mongo_db()
    if db:
        await db.telemetry.insert_one({
            "event_type": "sms_received",
            "data": {"sender": from_number, "message": str(body), "sid": message_sid},
            "timestamp": datetime.utcnow(),
        })

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Blackout AI received your query.</Message></Response>"""

# ============ Sync Endpoints ============

@app.post("/sync")
async def sync_data(request: SyncRequest):
    db = get_mongo_db()

    synced_convs = 0
    synced_telem = 0

    if db:
        if request.conversations:
            result = await db.conversations.insert_many(request.conversations)
            synced_convs = len(result.inserted_ids)

        if request.telemetry:
            result = await db.telemetry.insert_many(request.telemetry)
            synced_telem = len(result.inserted_ids)
    else:
        synced_convs = len(request.conversations)
        synced_telem = len(request.telemetry)

    return {
        "synced_conversations": synced_convs,
        "synced_telemetry": synced_telem,
        "timestamp": datetime.utcnow().isoformat(),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
