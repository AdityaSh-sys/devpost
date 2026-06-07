"""
Blackout Backend - FastAPI Application
Handles: Gemini API, Twilio SMS, MongoDB Atlas, Arize Phoenix
SMS Mode: Full SMS -> Gemini -> SMS response loop
"""
import os
import time
import json
import hmac
import hashlib
import base64
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("blackout")

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

GEMINI_MODEL = "gemini-2.5-flash-lite"
SMS_MAX_LENGTH = 1500
SMS_CONTINUE_MARKER = "\n\n[Reply CONTINUE for more]"

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
        logger.warning("Phoenix not installed. Run: pip install arize-phoenix-otel openinference-instrumentation")
        return None

try:
    tracer_provider = init_phoenix()
except Exception as e:
    logger.warning(f"Phoenix initialization failed (non-fatal): {e}")
    tracer_provider = None

# ============ Gemini ============

SYSTEM_PROMPT = """You are Blackout AI, an intelligent assistant that works across all connectivity conditions — online, via SMS, and completely offline. You specialize in providing helpful, accurate, and concise answers.

Key traits:
- You are helpful, knowledgeable, and empathetic
- You provide clear, actionable information
- For emergency/medical queries, you prioritize safety and recommend professional help
- You format responses with clear structure
- You are aware that users may be in areas with limited connectivity
- Keep responses concise and SMS-friendly
- Do not use markdown formatting
- Use plain text with simple bullet points (use -) and numbered lists
- Keep each response under 1000 characters when possible"""

async def call_gemini(query: str, history: list[dict] | None = None) -> tuple[str, int]:
    """Call Gemini API. Returns (response_text, latency_ms)."""
    start = time.time()

    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

    contents = [
        {"role": "user", "parts": [{"text": SYSTEM_PROMPT}]},
        {"role": "model", "parts": [{"text": "Understood. I'm Blackout AI, ready to help."}]},
    ]

    if history:
        for msg in history[-10:]:
            role = "model" if msg.get("role") == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]})

    contents.append({"role": "user", "parts": [{"text": query}]})

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, json={
            "contents": contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 1024,
            },
        })
        resp.raise_for_status()
        data = resp.json()

    text = data["candidates"][0]["content"]["parts"][0]["text"]
    latency = int((time.time() - start) * 1000)
    return text, latency

# ============ Twilio SMS Utilities ============

async def send_sms_via_twilio(to_number: str, body: str) -> dict:
    """Send an SMS via Twilio API. Returns Twilio response dict."""
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        raise RuntimeError("Twilio is not configured")

    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    auth_b64 = base64.b64encode(f"{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}".encode()).decode()

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Basic {auth_b64}"},
            data={
                "To": to_number,
                "From": TWILIO_PHONE_NUMBER,
                "Body": body,
            },
        )
        resp.raise_for_status()
        return resp.json()

def truncate_sms_response(text: str, max_length: int = SMS_MAX_LENGTH) -> str:
    """Truncate response to fit SMS limits, preserving complete sentences."""
    if len(text) <= max_length:
        return text

    truncated = text[:max_length]
    last_period = truncated.rfind(".")
    last_newline = truncated.rfind("\n")
    last_break = max(last_period, last_newline)

    if last_break > max_length // 2:
        truncated = text[: last_break + 1]
    else:
        last_space = truncated.rfind(" ")
        if last_space > max_length // 2:
            truncated = text[:last_space]

    return truncated.strip() + SMS_CONTINUE_MARKER

def verify_twilio_request(request: Request, url: str) -> bool:
    """Verify that a request genuinely came from Twilio using signature validation."""
    twilio_signature = request.headers.get("X-Twilio-Signature", "")
    if not twilio_signature or not TWILIO_AUTH_TOKEN:
        return False

    expected = hmac.new(
        TWILIO_AUTH_TOKEN.encode(),
        url.encode(),
        hashlib.sha1,
    ).digest()

    provided = base64.b64decode(twilio_signature)
    return hmac.compare_digest(expected, provided)

# ============ Offline Fallback Knowledge Base ============

OFFLINE_KNOWLEDGE = [
    {
        "keywords": ["cut", "wound", "bleed", "first aid", "injury"],
        "answer": "First aid for cuts: 1. Apply firm direct pressure with a clean cloth for 10+ minutes to stop bleeding. 2. Clean gently with clean water. 3. Apply antibiotic ointment if available. 4. Cover with sterile bandage. 5. Watch for infection (redness, swelling, warmth, pus). Seek medical help if bleeding doesn't stop after 10 minutes, the cut is deep, or you can't remove debris.",
    },
    {
        "keywords": ["water", "purif", "drink", "boil", "purify"],
        "answer": "Emergency water purification: Boiling is most reliable - boil for 1 minute (3 minutes above 6,500 ft). Chemical: 2 drops unscented bleach per liter, wait 30 minutes. Solar: fill clear bottles, place in direct sunlight 6+ hours. Always filter through cloth first to remove particles.",
    },
    {
        "keywords": ["earthquake", "quake", "tremor"],
        "answer": "Earthquake safety: DROP, COVER, and HOLD ON. Indoors: get under sturdy desk, stay away from windows. Outdoors: move to open area away from buildings and power lines. Driving: pull over, stop, set parking brake. After: check for injuries, expect aftershocks, check gas and water lines.",
    },
    {
        "keywords": ["cpr", "cardiac", "heart", "resuscitat", "breath"],
        "answer": "CPR: 1. Call emergency services immediately. 2. Place heel of hand on center of chest. 3. Push hard and fast - 2 inches deep, 100-120 compressions per minute. 4. After 30 compressions, give 2 rescue breaths. 5. Continue until help arrives. For infants: use 2 fingers, compress 1.5 inches deep.",
    },
    {
        "keywords": ["rescue", "signal", "sos", "help"],
        "answer": "Rescue signals: Visual - 3 fires in triangle, mirror flash toward aircraft, create large SOS with rocks. Audio - 3 whistle blasts repeated. Night - flashlight in groups of 3 flashes. Universal distress signal: anything in groups of three.",
    },
    {
        "keywords": ["shelter", "survival", "wilderness", "build"],
        "answer": "Building a wilderness shelter: Find location with natural windbreak. Debris hut: create A-frame with ridgepole, layer branches and leaves. Lean-to: prop branches against horizontal support. Insulate floor with dry leaves. Face opening away from wind. Keep shelter small to retain body heat.",
    },
    {
        "keywords": ["stroke", "fast", "face", "arm", "speech"],
        "answer": "Stroke signs - remember FAST: Face drooping on one side, Arm weakness (one arm drifts down), Speech difficulty (slurred), Time to call emergency. Also watch for sudden numbness, confusion, vision problems, severe headache. Every minute counts - get help immediately.",
    },
    {
        "keywords": ["dehydrat", "water", "thirst", "dry"],
        "answer": "Dehydration treatment: Mild - drink small sips of water frequently. Add oral rehydration salts (or 6 tsp sugar + 1/2 tsp salt per liter water). Avoid caffeine and alcohol. Rest in shade. Severe symptoms (confusion, rapid heartbeat, no urination) - seek medical help immediately.",
    },
]

def offline_fallback(query: str) -> str:
    """Match query against offline knowledge base. Returns best answer or generic response."""
    q = query.lower()

    best_score = 0
    best_answer = ""

    for entry in OFFLINE_KNOWLEDGE:
        score = sum(1 for kw in entry["keywords"] if kw in q)
        if score > best_score:
            best_score = score
            best_answer = entry["answer"]

    if best_score > 0:
        return best_answer

    if "emergency" in q or "help" in q:
        return "This is an automated offline response. For emergencies: 1. Call local emergency number if possible. 2. Move to a safe location. 3. Apply first aid: pressure to wounds, keep breathing steady. Your query has been queued for a full response when connectivity returns."

    if "weather" in q or "forecast" in q:
        return "I cannot access current weather data without internet. Your query has been queued. Look for natural weather indicators: cloud formations, wind changes, and barometric pressure shifts."

    return f"I am in offline mode and could not find a specific answer to your question. Available offline topics: First Aid, Emergency Procedures, Water Purification, Shelter Building, Survival Skills, CPR, Rescue Signals. Try asking about these for immediate answers."

# ============ Health Check ============

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
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
        text, latency = await call_gemini(request.query, request.history)

        db = get_mongo_db()
        if db is not None:
            await db.conversations.insert_one({
                "query": request.query,
                "response": text,
                "connectivity_state": "online",
                "model_used": f"Gemini {GEMINI_MODEL}",
                "latency_ms": latency,
                "timestamp": datetime.now(timezone.utc),
            })

        return ChatResponse(response=text, model=f"Gemini {GEMINI_MODEL}", latency_ms=latency)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============ SMS Send Endpoint ============

@app.post("/sms/send")
async def send_sms(request: SMSRequest):
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        return {"status": "demo", "message": "Twilio not configured", "query": request.query}

    try:
        result = await send_sms_via_twilio(
            to_number=request.phone_number or SMS_RECIPIENT,
            body=f"BLACKOUT: {request.query[:140]}",
        )

        db = get_mongo_db()
        if db is not None:
            await db.telemetry.insert_one({
                "event_type": "sms_sent",
                "data": {"recipient": request.phone_number or SMS_RECIPIENT, "sid": result.get("sid")},
                "timestamp": datetime.now(timezone.utc),
            })

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============ SMS Webhook (SMS -> Gemini -> SMS Loop) ============

@app.post("/sms/webhook")
async def sms_webhook(request: Request):
    """Twilio webhook — receives SMS, queries Gemini, sends response back via SMS."""
    process_start = time.time()

    try:
        form = await request.form()
    except Exception:
        logger.error("Failed to parse webhook form data")
        return _twiml_response("Error processing your request. Please try again.")

    body = (form.get("Body", "") or "").strip()
    from_number = (form.get("From", "") or "").strip()
    message_sid = (form.get("MessageSid", "") or "").strip()

    # Structured logging: inbound SMS
    logger.info(json.dumps({
        "event": "sms_inbound",
        "sender": from_number,
        "message_length": len(body),
        "message_sid": message_sid,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }))

    # Validate input
    if not from_number:
        logger.warning("SMS webhook received empty sender")
        return _twiml_response("Missing sender information.")

    if not body:
        logger.warning(f"Empty SMS from {from_number}")
        return _twiml_response("Please send a message with your question.")

    # Step 1: Query Gemini
    gemini_success = False
    gemini_latency = 0
    answer = ""

    try:
        logger.info(f"Calling Gemini for SMS from {from_number}: query={body[:80]}...")
        answer, gemini_latency = await call_gemini(body)
        gemini_success = True

        logger.info(json.dumps({
            "event": "gemini_success",
            "latency_ms": gemini_latency,
            "query_length": len(body),
            "sender": from_number,
        }))
    except Exception as e:
        logger.warning(json.dumps({
            "event": "gemini_failure",
            "error_type": type(e).__name__,
            "error_message": str(e),
            "sender": from_number,
        }))

    # Step 2: Fallback to offline KB if Gemini failed
    if not gemini_success:
        logger.info(f"Using offline fallback for SMS from {from_number}")
        answer = offline_fallback(body)

    # Step 3: Truncate for SMS
    answer = truncate_sms_response(answer)

    # Step 4: Send response SMS
    sms_success = False
    try:
        result = await send_sms_via_twilio(to_number=from_number, body=answer)
        sms_success = True

        logger.info(json.dumps({
            "event": "sms_outbound",
            "recipient": from_number,
            "response_length": len(answer),
            "twilio_sid": result.get("sid"),
            "success": True,
        }))
    except Exception as e:
        logger.error(json.dumps({
            "event": "sms_outbound_failure",
            "recipient": from_number,
            "error_type": type(e).__name__,
            "error_message": str(e),
            "response_length": len(answer),
        }))

    # Step 5: Store conversation in MongoDB
    try:
        db = get_mongo_db()
        if db is not None:
            await db.conversations.insert_one({
                "query": body,
                "response": answer,
                "connectivity_state": "sms",
                "model_used": f"Gemini {GEMINI_MODEL}" if gemini_success else "Offline Fallback",
                "latency_ms": int((time.time() - process_start) * 1000),
                "gemini_latency_ms": gemini_latency,
                "sender": from_number,
                "message_sid": message_sid,
                "gemini_success": gemini_success,
                "sms_success": sms_success,
                "timestamp": datetime.now(timezone.utc),
            })
    except Exception as e:
        logger.warning(f"Failed to store conversation in MongoDB: {e}")

    total_latency = int((time.time() - process_start) * 1000)

    logger.info(json.dumps({
        "event": "sms_webhook_complete",
        "sender": from_number,
        "total_latency_ms": total_latency,
        "gemini_success": gemini_success,
        "sms_success": sms_success,
    }))

    return _twiml_response("Blackout AI received your query. Processing complete.")

def _twiml_response(message: str):
    """Generate a TwiML response with a message."""
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>{message}</Message></Response>"""
    return Response(content=twiml, media_type="text/xml")

# ============ Sync Endpoint ============

@app.post("/sync")
async def sync_data(request: SyncRequest):
    db = get_mongo_db()

    synced_convs = 0
    synced_telem = 0

    if db is not None:
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
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
