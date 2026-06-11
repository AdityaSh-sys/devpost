"""
Blackout Backend - FastAPI Application
Handles: Gemini API, MongoDB Atlas, Arize Phoenix, KB auto-update, Auth, Sessions, Sync
"""
import os
import time
import json
import math
import hashlib
import uuid
from datetime import datetime, timezone, timedelta

def _now():
    return datetime.now(timezone.utc)
from collections import Counter
import asyncio
import httpx
import bcrypt
from jose import jwt, JWTError

from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from typing import Optional

dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path)

app = FastAPI(
    title="Blackout API",
    description="Backend for Blackout - Connectivity Spectrum AI",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ Configuration ============

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MONGODB_URI = os.getenv("MONGODB_URI", "")
PHOENIX_API_KEY = os.getenv("PHOENIX_API_KEY", "")
KB_UPDATE_INTERVAL = int(os.getenv("KB_UPDATE_INTERVAL", "10"))
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_REFRESH_SECRET = os.getenv("JWT_REFRESH_SECRET", "")
ACCESS_TOKEN_EXPIRE_DAYS = 7
REFRESH_TOKEN_EXPIRE_DAYS = 30

# ============ MongoDB Client ============

_mongo_client = None
_mongo_db = None

def get_mongo_db():
    global _mongo_client, _mongo_db
    if _mongo_db is None and MONGODB_URI:
        from motor.motor_asyncio import AsyncIOMotorClient
        _mongo_client = AsyncIOMotorClient(MONGODB_URI)
        _mongo_db = _mongo_client.blackout
    return _mongo_db

# ============ Auth Models ============

class SignupRequest(BaseModel):
    email: str
    password: str
    display_name: str

class LoginRequest(BaseModel):
    email: str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict

class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    created_at: str

# ============ Session Models ============

class CreateSessionRequest(BaseModel):
    connectivity_mode: str = "online"
    is_guest: bool = False

class UpdateSessionRequest(BaseModel):
    title: Optional[str] = None

class SessionResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    message_count: int
    last_message_preview: str
    connectivity_mode: str
    is_guest: bool
    messages: list = []

# ============ Sync Models ============

class SyncPushRequest(BaseModel):
    sessions: list[dict] = []
    messages: list[dict] = []

class SyncPullResponse(BaseModel):
    sessions: list[dict]
    messages: list[dict]
    server_time: str

# ============ JWT Helpers ============

def create_access_token(user_id: str) -> str:
    expiry = _now() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {"sub": user_id, "exp": expiry, "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def create_refresh_token(user_id: str) -> str:
    expiry = _now() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {"sub": user_id, "exp": expiry, "type": "refresh"}
    return jwt.encode(payload, JWT_REFRESH_SECRET, algorithm="HS256")

def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        if payload.get("type") != "access":
            return None
        return payload
    except JWTError:
        return None

def decode_refresh_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, JWT_REFRESH_SECRET, algorithms=["HS256"])
        if payload.get("type") != "refresh":
            return None
        return payload
    except JWTError:
        return None

# ============ Auth Dependency ============

async def get_optional_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    if payload is None:
        return None
    db = get_mongo_db()
    if db is None:
        return None
    user = await db.users.find_one({"_id": payload["sub"]}, {"password_hash": 0})
    return user

async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1]
    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    user = await db.users.find_one({"_id": payload["sub"]}, {"password_hash": 0})
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user

async def get_optional_current_user(authorization: str = Header(None)):
    try:
        return await get_current_user(authorization)
    except HTTPException:
        return None

# ============ Auth Endpoints ============

@app.post("/auth/signup", response_model=TokenResponse)
async def auth_signup(request: SignupRequest):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    existing = await db.users.find_one({"email": request.email.lower().strip()})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    password_hash = bcrypt.hashpw(request.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user_id = str(uuid.uuid4())

    user_doc = {
        "_id": user_id,
        "email": request.email.lower().strip(),
        "password_hash": password_hash,
        "display_name": request.display_name.strip(),
        "token_version": 0,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.users.insert_one(user_doc)

    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user={
            "id": user_id,
            "email": user_doc["email"],
            "display_name": user_doc["display_name"],
            "created_at": user_doc["created_at"].isoformat(),
        }
    )


@app.post("/auth/login", response_model=TokenResponse)
async def auth_login(request: LoginRequest):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    user = await db.users.find_one({"email": request.email.lower().strip()})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not bcrypt.checkpw(request.password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token(user["_id"])
    refresh_token = create_refresh_token(user["_id"])

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user={
            "id": user["_id"],
            "email": user["email"],
            "display_name": user["display_name"],
            "created_at": user["created_at"].isoformat(),
        }
    )


@app.post("/auth/refresh")
async def auth_refresh(request: RefreshRequest):
    payload = decode_refresh_token(request.refresh_token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    user = await db.users.find_one({"_id": payload["sub"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Check if token is revoked by comparing token_version
    revoked = await db.revoked_tokens.find_one({"token": hashlib.sha256(request.refresh_token.encode()).hexdigest()})
    if revoked:
        raise HTTPException(status_code=401, detail="Token revoked")

    new_access_token = create_access_token(user["_id"])
    return {"access_token": new_access_token, "token_type": "bearer"}


@app.post("/auth/logout")
async def auth_logout(request: RefreshRequest, user: dict = Depends(get_current_user)):
    # Revoke the refresh token
    db = get_mongo_db()
    if db is not None:
        token_hash = hashlib.sha256(request.refresh_token.encode()).hexdigest()
        await db.revoked_tokens.insert_one({
            "token": token_hash,
            "user_id": user["_id"],
            "revoked_at": _now(),
        })
        # Cleanup old revoked tokens
        await db.revoked_tokens.delete_many({"revoked_at": {"$lt": _now() - timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)}})

    return {"status": "ok", "message": "Logged out successfully"}


@app.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {
        "id": user["_id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "created_at": user["created_at"].isoformat(),
    }


# ============ Session Endpoints ============

@app.post("/sessions")
async def create_session(request: CreateSessionRequest, user: dict | None = Depends(get_optional_current_user)):
    db = get_mongo_db()
    session_id = str(uuid.uuid4())
    now = _now()

    session = {
        "_id": session_id,
        "user_id": user["_id"] if user else None,
        "title": "New Chat",
        "created_at": now,
        "updated_at": now,
        "message_count": 0,
        "last_message_preview": "",
        "connectivity_mode": request.connectivity_mode,
        "is_guest": request.is_guest,
        "deleted_at": None,
        "messages": [],
    }

    if db is not None:
        await db.sessions.insert_one(session)

    return {"id": session_id, **{k: v for k, v in session.items() if k != "_id" and k != "messages" and k != "deleted_at"}, "messages": []}


@app.get("/sessions")
async def list_sessions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
):
    db = get_mongo_db()
    if db is None:
        return {"sessions": [], "total": 0, "limit": limit, "offset": offset}

    query = {"user_id": user["_id"], "deleted_at": None}
    cursor = db.sessions.find(query).sort("updated_at", -1).skip(offset).limit(limit)
    sessions = await cursor.to_list(length=limit)
    total = await db.sessions.count_documents(query)

    result = []
    for s in sessions:
        result.append({
            "id": s["_id"],
            "title": s.get("title", "New Chat"),
            "created_at": s["created_at"].isoformat(),
            "updated_at": s["updated_at"].isoformat(),
            "message_count": s.get("message_count", 0),
            "last_message_preview": s.get("last_message_preview", ""),
            "connectivity_mode": s.get("connectivity_mode", "online"),
            "is_guest": s.get("is_guest", False),
        })

    return {"sessions": result, "total": total, "limit": limit, "offset": offset}


@app.get("/sessions/{session_id}")
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    session = await db.sessions.find_one({"_id": session_id, "deleted_at": None})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.get("user_id") and session["user_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized to view this session")

    return {
        "id": session["_id"],
        "title": session.get("title", "New Chat"),
        "created_at": session["created_at"].isoformat(),
        "updated_at": session["updated_at"].isoformat(),
        "message_count": session.get("message_count", 0),
        "last_message_preview": session.get("last_message_preview", ""),
        "connectivity_mode": session.get("connectivity_mode", "online"),
        "is_guest": session.get("is_guest", False),
        "messages": session.get("messages", []),
    }


@app.patch("/sessions/{session_id}")
async def update_session(session_id: str, request: UpdateSessionRequest, user: dict = Depends(get_current_user)):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    session = await db.sessions.find_one({"_id": session_id, "deleted_at": None})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.get("user_id") and session["user_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    update = {"updated_at": _now()}
    if request.title is not None:
        update["title"] = request.title

    await db.sessions.update_one({"_id": session_id}, {"$set": update})
    return {"status": "ok"}


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user: dict = Depends(get_current_user)):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    session = await db.sessions.find_one({"_id": session_id, "deleted_at": None})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.get("user_id") and session["user_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    await db.sessions.update_one({"_id": session_id}, {"$set": {"deleted_at": _now()}})
    return {"status": "ok"}


@app.post("/sessions/{session_id}/title/generate")
async def generate_session_title(session_id: str, user: dict = Depends(get_current_user)):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    session = await db.sessions.find_one({"_id": session_id, "deleted_at": None})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.get("user_id") and session["user_id"] != user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    messages = session.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="No messages to generate title from")

    first_user_msg = None
    for m in messages:
        if m.get("role") == "user":
            first_user_msg = m.get("content", "")
            break

    if not first_user_msg:
        raise HTTPException(status_code=400, detail="No user message found")

    try:
        title = await _generate_title(first_user_msg)
        await db.sessions.update_one({"_id": session_id}, {"$set": {"title": title, "updated_at": _now()}})
        return {"title": title}
    except Exception as e:
        # Fallback title
        title = first_user_msg[:50].strip()
        if len(title) > 50:
            title = title[:47] + "..."
        await db.sessions.update_one({"_id": session_id}, {"$set": {"title": title, "updated_at": _now()}})
        return {"title": title}


async def _generate_title(message: str) -> str:
    if not GEMINI_API_KEY:
        return message[:50].strip()

    prompt = f"Generate a very short title (max 6 words, no quotes) for a conversation that starts with: \"{message[:200]}\""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={GEMINI_API_KEY}",
                json={
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": 30},
                },
            )
            resp.raise_for_status()
            data = resp.json()
            title = data["candidates"][0]["content"]["parts"][0]["text"].strip().strip('"').strip("'")
            words = title.split()
            if len(words) > 6:
                title = " ".join(words[:6])
            return title
    except Exception:
        return message[:50].strip()


# ============ Sync Endpoints ============

@app.get("/sync/pull")
async def sync_pull(since: str = Query("1970-01-01T00:00:00Z"), user: dict = Depends(get_current_user)):
    db = get_mongo_db()
    if db is None:
        return SyncPullResponse(sessions=[], messages=[], server_time=_now().isoformat())

    try:
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        since_dt = datetime(1970, 1, 1, tzinfo=timezone.utc)

    session_query = {
        "user_id": user["_id"],
        "updated_at": {"$gt": since_dt},
        "deleted_at": None,
    }
    sessions_cursor = db.sessions.find(session_query).sort("updated_at", -1).limit(100)
    sessions = await sessions_cursor.to_list(length=100)

    result_sessions = []
    result_messages = []
    for s in sessions:
        result_sessions.append({
            "id": s["_id"],
            "user_id": s.get("user_id"),
            "title": s.get("title", "New Chat"),
            "created_at": s["created_at"].isoformat(),
            "updated_at": s["updated_at"].isoformat(),
            "message_count": s.get("message_count", 0),
            "last_message_preview": s.get("last_message_preview", ""),
            "connectivity_mode": s.get("connectivity_mode", "online"),
            "is_guest": s.get("is_guest", False),
        })
        for m in s.get("messages", []):
            m["session_id"] = s["_id"]
            result_messages.append(m)

    return SyncPullResponse(sessions=result_sessions, messages=result_messages, server_time=_now().isoformat())


@app.post("/sync/push")
async def sync_push(request: SyncPushRequest, user: dict = Depends(get_current_user)):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    conflicts = []
    synced_sessions = 0
    synced_messages = 0

    for session_data in request.sessions:
        session_id = session_data.get("id")
        if not session_id:
            continue

        server_session = await db.sessions.find_one({"_id": session_id})
        local_updated = session_data.get("updated_at", "")
        try:
            local_dt = datetime.fromisoformat(local_updated.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            local_dt = _now()

        if server_session:
            server_updated = server_session.get("updated_at", _now())
            if local_dt > server_updated:
                # Local is newer, update server
                update = {
                    "title": session_data.get("title", server_session.get("title")),
                    "message_count": session_data.get("message_count", server_session.get("message_count", 0)),
                    "last_message_preview": session_data.get("last_message_preview", ""),
                    "connectivity_mode": session_data.get("connectivity_mode", server_session.get("connectivity_mode")),
                    "updated_at": local_dt,
                }
                await db.sessions.update_one({"_id": session_id}, {"$set": update})
                synced_sessions += 1
            elif server_updated > local_dt:
                # Server has newer version
                conflicts.append({
                    "session_id": session_id,
                    "type": "session",
                    "server_version": server_updated.isoformat(),
                    "local_version": local_updated,
                })
        else:
            # New session from client
            new_session = {
                "_id": session_id,
                "user_id": user["_id"],
                "title": session_data.get("title", "New Chat"),
                "created_at": local_dt,
                "updated_at": local_dt,
                "message_count": session_data.get("message_count", 0),
                "last_message_preview": session_data.get("last_message_preview", ""),
                "connectivity_mode": session_data.get("connectivity_mode", "online"),
                "is_guest": session_data.get("is_guest", False),
                "deleted_at": None,
                "messages": [],
            }
            await db.sessions.insert_one(new_session)
            synced_sessions += 1

    # Process messages
    if request.messages:
        msg_by_session = {}
        for m in request.messages:
            sid = m.get("session_id")
            if sid:
                msg_by_session.setdefault(sid, []).append(m)

        for sid, msgs in msg_by_session.items():
            session = await db.sessions.find_one({"_id": sid})
            if session:
                existing_msg_ids = {msg.get("id") for msg in session.get("messages", [])}
                new_msgs = [m for m in msgs if m.get("id") not in existing_msg_ids]
                if new_msgs:
                    await db.sessions.update_one(
                        {"_id": sid},
                        {"$push": {"messages": {"$each": new_msgs}}, "$set": {"updated_at": _now()}}
                    )
                    synced_messages += len(new_msgs)
                    # Update message_count
                    await db.sessions.update_one(
                        {"_id": sid},
                        {"$set": {"message_count": len(session.get("messages", [])) + len(new_msgs)}}
                    )

    return {
        "synced_sessions": synced_sessions,
        "synced_messages": synced_messages,
        "conflicts": conflicts,
        "server_time": _now().isoformat(),
    }


# ============ Existing Models ============

class ChatRequest(BaseModel):
    query: str
    history: list[dict] = []

class ChatResponse(BaseModel):
    response: str
    model: str
    latency_ms: int
    span_id: str | None = None
    trace_id: str | None = None

class ChatOfflineRequest(BaseModel):
    query: str
    history: list[dict] = []

class FeedbackRequest(BaseModel):
    span_id: str
    trace_id: str
    label: str
    score: float
    comment: str | None = None

class SyncRequest(BaseModel):
    conversations: list[dict] = []
    telemetry: list[dict] = []

# ============ Query Counter ============

_query_count = 0

def increment_query_count():
    global _query_count
    _query_count += 1
    return _query_count

def get_query_count():
    return _query_count

async def maybe_trigger_kb_update(query: str, response: str, latency_ms: int):
    count = increment_query_count()
    if count % KB_UPDATE_INTERVAL == 0:
        asyncio.ensure_future(generate_kb_update(query, response))

# ============ Arize Phoenix Tracing ============

_tracer = None

def init_phoenix():
    global _tracer
    if not PHOENIX_API_KEY:
        print("Arize Phoenix: No API key configured — tracing disabled")
        return None
    try:
        from opentelemetry import trace
        from phoenix.otel import register

        base_endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "https://app.phoenix.arize.com")
        full_endpoint = base_endpoint.rstrip("/")
        if not full_endpoint.endswith("/v1/traces"):
            full_endpoint += "/v1/traces"
        os.environ.setdefault("OTEL_EXPORTER_OTLP_HEADERS", f"api_key={PHOENIX_API_KEY}")
        tracer_provider = register(
            project_name="blackout",
            endpoint=full_endpoint,
            protocol="http/protobuf",
        )
        _tracer = trace.get_tracer("blackout.backend")
        print(f"Arize Phoenix tracing initialized — endpoint: {full_endpoint}")
        return tracer_provider
    except ImportError:
        print("Arize Phoenix: packages not installed. Run: pip install arize-phoenix-otel openinference-instrumentation")
        return None
    except Exception as e:
        print(f"Arize Phoenix: initialization failed — {e}")
        return None

tracer_provider = init_phoenix()

def get_tracer():
    return _tracer

# ============ Health Check ============

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "timestamp": _now().isoformat(),
        "services": {
            "gemini": bool(GEMINI_API_KEY),
            "mongodb": bool(MONGODB_URI),
            "phoenix": bool(PHOENIX_API_KEY),
        },
        "query_count": get_query_count(),
        "kb_update_interval": KB_UPDATE_INTERVAL,
    }

@app.head("/ping")
@app.get("/ping")
async def ping():
    return {"status": "ok", "timestamp": time.time()}

# ============ Gemini Helper ============

async def _call_gemini(query: str, history: list[dict] | None = None, system_prompt: str | None = None) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={GEMINI_API_KEY}"

    if not system_prompt:
        system_prompt = "You are Blackout AI, a helpful assistant that works across all connectivity modes. Provide clear, accurate, and well-structured responses."

    contents = [
        {"role": "user", "parts": [{"text": system_prompt}]},
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
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
        })
        resp.raise_for_status()
        data = resp.json()

    return data["candidates"][0]["content"]["parts"][0]["text"]

# ============ Chat Endpoint ============

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, user: dict | None = Depends(get_optional_current_user)):
    start = time.time()
    tracer = get_tracer()

    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Gemini API key not configured")

    try:
        if tracer:
            with tracer.start_as_current_span("chat") as span:
                span.set_attribute("query", request.query[:500])
                span.set_attribute("history_length", len(request.history))
                span.set_attribute("connectivity_mode", "online")
                span.set_attribute("model", "gemini-2.5-flash-lite")
                text = await _call_gemini(request.query, request.history)
                latency = int((time.time() - start) * 1000)
                span.set_attribute("response_length", len(text))
                span.set_attribute("latency_ms", latency)
                sc = span.get_span_context()
                span_id = format(sc.span_id, "016x")
                trace_id = format(sc.trace_id, "032x")
        else:
            text = await _call_gemini(request.query, request.history)
            latency = int((time.time() - start) * 1000)
            span_id = None
            trace_id = None

        db = get_mongo_db()
        if db is not None:
            await db.conversations.insert_one({
                "query": request.query,
                "response": text,
                "connectivity_state": "online",
                "model_used": "Gemini 2.5 Flash Lite",
                "latency_ms": latency,
                "timestamp": _now(),
                "user_id": user["_id"] if user else None,
            })

        asyncio.ensure_future(maybe_trigger_kb_update(request.query, text, latency))
        asyncio.ensure_future(_evaluate_response_quality(span_id or "", request.query, text, latency, "online"))

        return ChatResponse(response=text, model="Blackout 0.1", latency_ms=latency, span_id=span_id, trace_id=trace_id)
    except Exception as e:
        tracer = get_tracer()
        if tracer:
            from opentelemetry import trace as otel_trace
            span = otel_trace.get_current_span()
            span.set_attribute("error_type", type(e).__name__)
            span.set_attribute("error_message", str(e)[:500])
            span.set_attribute("connectivity_mode", "online")
        raise HTTPException(status_code=500, detail=str(e))


# ============ Offline Chat (Local Gemma via Ollama) ============

async def _search_kb(query: str, max_results: int = 3) -> list[dict]:
    """Search knowledge base for entries relevant to the query (keyword overlap)."""
    db = get_mongo_db()
    if db is None:
        return []
    try:
        all_entries = await db.kb_entries.find().to_list(length=500)
        if not all_entries:
            return []

        query_tokens = set(w.lower() for w in query.split() if len(w) > 2)
        if not query_tokens:
            return []

        scored = []
        for entry in all_entries:
            text = (entry.get("question", "") + " " + entry.get("answer", "")).lower()
            entry_tokens = set(w for w in text.split() if len(w) > 2)
            if not entry_tokens:
                continue
            overlap = len(query_tokens & entry_tokens)
            score = overlap / len(query_tokens) if query_tokens else 0
            if score > 0:
                scored.append((score, entry))

        scored.sort(key=lambda x: -x[0])
        return [
            {"question": e["question"], "answer": e["answer"], "score": round(s, 3)}
            for s, e in scored[:max_results]
        ]
    except Exception:
        return []


@app.post("/chat/offline", response_model=ChatResponse)
async def chat_offline(request: ChatOfflineRequest, user: dict | None = Depends(get_optional_current_user)):
    start = time.time()
    tracer = get_tracer()

    kb_contexts = await _search_kb(request.query)
    rag_context = ""
    if kb_contexts:
        rag_context = "Here are some relevant knowledge base entries to help answer:\n\n" + \
            "\n\n".join(
                f"Q: {c['question']}\nA: {c['answer']}"
                for c in kb_contexts
            ) + "\n\nUse these as reference, but adapt your answer to the user's specific question."

    try:
        system_prompt = "You are Blackout AI, a helpful offline assistant. Be concise and direct."
        if rag_context:
            system_prompt += f"\n\n{rag_context}"

        if tracer:
            with tracer.start_as_current_span("chat_offline") as span:
                span.set_attribute("query", request.query[:500])
                span.set_attribute("history_length", len(request.history))

                async with httpx.AsyncClient(timeout=60) as client:
                    messages = [{"role": "system", "content": system_prompt}]
                    for msg in request.history[-10:]:
                        role = "assistant" if msg.get("role") == "assistant" else "user"
                        messages.append({"role": role, "content": msg.get("content", "")})
                    messages.append({"role": "user", "content": request.query})

                    resp = await client.post(
                        f"{OLLAMA_URL}/api/chat",
                        json={"model": "gemma2:2b", "messages": messages, "stream": False},
                    )
                    if not resp.is_success:
                        try:
                            err_body = resp.json()
                            err_msg = err_body.get("error", str(resp.status_code))
                        except Exception:
                            err_msg = f"Ollama error {resp.status_code}"
                        raise RuntimeError(err_msg)
                    data = resp.json()

                text = data["message"]["content"]
                latency = int((time.time() - start) * 1000)
                span.set_attribute("response_length", len(text))
                span.set_attribute("latency_ms", latency)
                span.set_attribute("model", "gemma2:2b")
                span.set_attribute("ollama_url", OLLAMA_URL)
                span.set_attribute("fallback_stage", "gemma")
                span.set_attribute("confidence", 0.9)
                span.set_attribute("connectivity_mode", "offline")
                span.set_attribute("rag_context_count", len(kb_contexts))
                span.set_attribute("rag_context_used", bool(kb_contexts))
                sc = span.get_span_context()
                span_id = format(sc.span_id, "016x")
                trace_id = format(sc.trace_id, "032x")
        else:
            async with httpx.AsyncClient(timeout=60) as client:
                messages = [{"role": "system", "content": system_prompt}]
                for msg in request.history[-10:]:
                    role = "assistant" if msg.get("role") == "assistant" else "user"
                    messages.append({"role": role, "content": msg.get("content", "")})
                messages.append({"role": "user", "content": request.query})

                resp = await client.post(
                    f"{OLLAMA_URL}/api/chat",
                    json={"model": "gemma2:2b", "messages": messages, "stream": False},
                )
                if not resp.is_success:
                    try:
                        err_body = resp.json()
                        err_msg = err_body.get("error", str(resp.status_code))
                    except Exception:
                        err_msg = f"Ollama error {resp.status_code}"
                    raise RuntimeError(err_msg)
                data = resp.json()

            text = data["message"]["content"]
            latency = int((time.time() - start) * 1000)
            span_id = None
            trace_id = None

        asyncio.ensure_future(_evaluate_response_quality(span_id or "", request.query, text, latency, "offline"))

        return ChatResponse(response=text, model="Blackout 0.1 Local", latency_ms=latency, span_id=span_id, trace_id=trace_id)
    except Exception as e:
        tracer = get_tracer()
        if tracer:
            from opentelemetry import trace as otel_trace
            span = otel_trace.get_current_span()
            span.set_attribute("error_type", "ollama_error")
            span.set_attribute("error_message", str(e)[:500])
            span.set_attribute("connectivity_mode", "offline")
        raise HTTPException(status_code=503, detail=f"Local model unavailable: {str(e)}")


@app.get("/chat/model/status")
async def model_status():
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {
                "available": "gemma2:2b" in models,
                "models": models,
                "ollama_connected": True,
            }
    except Exception:
        return {"available": False, "models": [], "ollama_connected": False}


@app.post("/chat/model/download")
async def model_download():
    try:
        async with httpx.AsyncClient(timeout=600) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/pull",
                json={"name": "gemma2:2b", "stream": False},
            )
            resp.raise_for_status()
            data = resp.json()
            return {"status": "success", "model": "gemma2:2b", "data": data}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Model download timed out (model is ~1.6GB, may take several minutes)")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Model download failed: {str(e)}")

# ============ User Feedback ============

@app.post("/feedback")
async def feedback(request: FeedbackRequest):
    try:
        from phoenix.client import Client

        collector_endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "")
        if collector_endpoint:
            os.environ.setdefault("PHOENIX_COLLECTOR_ENDPOINT", collector_endpoint)
        os.environ.setdefault("PHOENIX_API_KEY", PHOENIX_API_KEY)

        client = Client()
        client.spans.add_span_annotation(
            span_id=request.span_id,
            annotation_name="user_feedback",
            annotator_kind="HUMAN",
            label=request.label,
            score=request.score,
            explanation=request.comment,
        )

        if request.label == "thumbs-down":
            asyncio.ensure_future(_improve_from_feedback_topic(request.span_id))

        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


# ============ Feedback Improvement Loop ============

async def _improve_from_feedback_topic(span_id: str):
    """When a user gives thumbs-down, fetch the query and generate a KB entry."""
    try:
        from phoenix.client import Client

        collector_endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "")
        if collector_endpoint:
            os.environ.setdefault("PHOENIX_COLLECTOR_ENDPOINT", collector_endpoint)
        os.environ.setdefault("PHOENIX_API_KEY", PHOENIX_API_KEY)

        client = Client()

        spans = client.spans.get_spans(
            project_identifier="blackout",
            span_ids=[span_id],
            timeout=10,
        )
        if not spans:
            return

        query_text = spans[0].attributes.get("query", "")
        response_text = spans[0].attributes.get("response.text", "")
        if not query_text:
            return

        db = get_mongo_db()
        if db is None:
            return

        existing = await db.kb_entries.find_one({"question": {"$regex": query_text[:50], "$options": "i"}})
        if existing:
            return

        from httpx import AsyncClient
        kb_prompt = (
            f"A user rated the answer to '{query_text}' as unhelpful. "
            f"Generate a single, high-quality Q&A pair that correctly answers this. "
            f"Format exactly as JSON: {{\"question\": \"...\", \"answer\": \"...\"}}\n"
            f"Answer must be 2-4 sentences, factual, and useful in a disaster/emergency scenario."
        )
        async with AsyncClient(timeout=15) as hx:
            gemini_resp = await hx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={GEMINI_API_KEY}",
                json={"contents": [{"role": "user", "parts": [{"text": kb_prompt}]}], "generationConfig": {"temperature": 0.3, "maxOutputTokens": 512}},
            )
            gemini_resp.raise_for_status()
            gemini_data = gemini_resp.json()
            gemini_text = gemini_data["candidates"][0]["content"]["parts"][0]["text"]
            gemini_text = gemini_text.replace("```json", "").replace("```", "").strip()

        try:
            qa = json.loads(gemini_text)
            question = qa.get("question", query_text)
            answer = qa.get("answer", response_text[:500])
        except (json.JSONDecodeError, KeyError):
            question = query_text
            answer = (response_text or "Information not available")[:500]

        question = question.strip().rstrip("?") + "?"
        category = _detect_category(question)

        from math import sqrt
        words = question.lower().split()
        embedding = [words.count(w) / sqrt(len(words) or 1) for w in sorted(set(words))] if words else [0.0]

        entry_id = hashlib.md5(question.encode()).hexdigest()
        await db.kb_entries.update_one(
            {"_id": entry_id},
            {"$set": {
                "question": question, "answer": answer,
                "embedding": embedding, "category": category,
                "source": "feedback-improvement", "created_at": _now(),
                "usage_count": 1,
            }},
            upsert=True,
        )
    except Exception:
        pass


# ============ Response Evaluations (Code-based) ============

async def _evaluate_response_quality(span_id: str, query: str, response: str, latency_ms: int, mode: str):
    """Code-based quality evaluations logged as Phoenix annotations."""
    if not span_id or not PHOENIX_API_KEY:
        return
    try:
        from phoenix.client import Client

        collector_endpoint = os.getenv("PHOENIX_COLLECTOR_ENDPOINT", "")
        if collector_endpoint:
            os.environ.setdefault("PHOENIX_COLLECTOR_ENDPOINT", collector_endpoint)
        os.environ.setdefault("PHOENIX_API_KEY", PHOENIX_API_KEY)

        client = Client()

        resp_len = len(response)
        if resp_len < 20:
            client.spans.add_span_annotation(
                span_id=span_id, annotation_name="response_length_quality",
                annotator_kind="CODE", score=0.2, label="too_short",
                explanation=f"Response is very short ({resp_len} chars). May lack detail.",
                sync=False,
            )
        elif resp_len < 50:
            client.spans.add_span_annotation(
                span_id=span_id, annotation_name="response_length_quality",
                annotator_kind="CODE", score=0.5, label="short",
                explanation=f"Response is short ({resp_len} chars). Could use more detail.",
                sync=False,
            )
        else:
            client.spans.add_span_annotation(
                span_id=span_id, annotation_name="response_length_quality",
                annotator_kind="CODE", score=1.0, label="adequate",
                explanation=f"Response length ({resp_len} chars) is adequate.",
                sync=False,
            )

        if latency_ms > 30000:
            client.spans.add_span_annotation(
                span_id=span_id, annotation_name="latency_quality",
                annotator_kind="CODE", score=0.2, label="very_slow",
                explanation=f"Response took {latency_ms}ms. Consider optimizing.",
                sync=False,
            )
        elif latency_ms > 15000:
            client.spans.add_span_annotation(
                span_id=span_id, annotation_name="latency_quality",
                annotator_kind="CODE", score=0.6, label="slow",
                explanation=f"Response took {latency_ms}ms.",
                sync=False,
            )
        else:
            client.spans.add_span_annotation(
                span_id=span_id, annotation_name="latency_quality",
                annotator_kind="CODE", score=1.0, label="fast",
                explanation=f"Response took {latency_ms}ms.",
                sync=False,
            )

        query_words = set(w.lower() for w in query.split() if len(w) > 3)
        response_words = set(w.lower() for w in response.split() if len(w) > 3)
        if query_words and response_words:
            overlap = len(query_words & response_words) / len(query_words)
            client.spans.add_span_annotation(
                span_id=span_id, annotation_name="query_relevance",
                annotator_kind="CODE", score=min(overlap * 1.5, 1.0),
                label="relevant" if overlap > 0.3 else "low_relevance",
                explanation=f"Keyword overlap: {overlap:.2f} ({len(query_words & response_words)}/{len(query_words)})",
                sync=False,
            )
    except Exception:
        pass


# ============ Knowledge Base Update Engine ============

async def generate_kb_update(last_query: str, last_response: str):
    """Generate new KB entries from recent usage patterns."""
    db = get_mongo_db()
    if db is None:
        return

    try:
        recent = await db.conversations.find().sort("timestamp", -1).limit(KB_UPDATE_INTERVAL * 2).to_list(length=KB_UPDATE_INTERVAL * 2)

        if len(recent) < 3:
            return

        queries = [r["query"] for r in recent if r.get("query")]
        responses = {r["query"]: r.get("response", "") for r in recent if r.get("query")}

        topic_counts = Counter()
        for q in queries:
            words = q.lower().split()[:5]
            for w in words:
                if len(w) > 3:
                    topic_counts[w] += 1

        top_topics = [t for t, _ in topic_counts.most_common(5)]
        if not top_topics:
            return

        kb_prompt = (
            "You are a knowledge base curator. Generate a single question-answer pair "
            "for an offline emergency/survival knowledge base. The question should be "
            f"related to these trending topics: {', '.join(top_topics[:3])}. "
            "Respond in JSON format exactly like: "
            '{"question": "...", "answer": "..."}\n'
            "Answer must be concise (2-4 sentences), factual, and useful in offline/disaster scenarios."
        )

        try:
            generated = await _call_gemini(kb_prompt, system_prompt=kb_prompt)
            generated = generated.strip()
            if generated.startswith("```"):
                generated = generated.split("\n", 1)[-1]
                if generated.endswith("```"):
                    generated = generated[:-3]
                generated = generated.strip()

            entry = json.loads(generated)
            question = entry.get("question", "")
            answer = entry.get("answer", "")
        except Exception:
            question = f"How to handle: {' '.join(top_topics[:3])}"
            answer = last_response[:500] if last_response else "Information not available."

        if not question or not answer:
            return

        embedding = _compute_embedding(question + " " + answer)
        category = _detect_category(question)

        doc_id = hashlib.md5(question.encode()).hexdigest()

        existing = await db.kb_entries.find_one({"_id": doc_id})
        if not existing:
            await db.kb_entries.insert_one({
                "_id": doc_id,
                "question": question,
                "answer": answer,
                "embedding": embedding,
                "category": category,
                "source": "auto-generated",
                "created_at": _now(),
                "usage_count": len(recent),
            })

        all_entries = await db.kb_entries.find().to_list(length=1000)
        for e in all_entries:
            e.pop("_id", None)

        kb_snapshot = {
            "version": int(time.time()),
            "generated_at": _now().isoformat(),
            "entry_count": len(all_entries),
            "entries": all_entries,
        }

        existing_snapshot = await db.kb_snapshots.find_one(sort=[("version", -1)])
        new_version = (existing_snapshot["version"] + 1) if existing_snapshot else 1
        kb_snapshot["version"] = new_version

        await db.kb_snapshots.insert_one(kb_snapshot)

        snapshots = await db.kb_snapshots.find().sort("version", -1).to_list(length=10)
        if len(snapshots) > 5:
            old_ids = [s["_id"] for s in snapshots[5:]]
            await db.kb_snapshots.delete_many({"_id": {"$in": old_ids}})

        print(f"KB update: version {new_version}, {len(all_entries)} entries")

    except Exception as e:
        print(f"KB update failed: {e}")


def _compute_embedding(text: str) -> list[float]:
    tokens = text.lower().split()
    vocab = {}
    for t in tokens:
        if t not in vocab:
            vocab[t] = len(vocab)
    vector = [0.0] * max(len(vocab), 100)
    for t in tokens:
        idx = vocab.get(t)
        if idx is not None and idx < len(vector):
            vector[idx] += 1.0
    mag = math.sqrt(sum(v * v for v in vector))
    if mag > 0:
        vector = [v / mag for v in vector]
    return vector


def _detect_category(text: str) -> str:
    text_lower = text.lower()
    if any(w in text_lower for w in ["medical", "injury", "first aid", "cut", "bleed", "cpr", "stroke", "dehydrat"]):
        return "medical"
    if any(w in text_lower for w in ["survival", "shelter", "water", "fire", "food", "purify"]):
        return "survival"
    if any(w in text_lower for w in ["emergency", "earthquake", "flood", "storm", "evacuat"]):
        return "emergency"
    if any(w in text_lower for w in ["safety", "signal", "rescue", "protect", "prevent"]):
        return "safety"
    return "general"


# ============ KB Endpoints ============

@app.get("/kb/version")
async def kb_version():
    db = get_mongo_db()
    if db is None:
        return JSONResponse(content={"version": 0, "entry_count": 0, "available": False})

    try:
        latest = await db.kb_snapshots.find_one(sort=[("version", -1)])
        if latest:
            return JSONResponse(content={
                "version": latest["version"],
                "entry_count": latest["entry_count"],
                "generated_at": latest["generated_at"],
                "available": True,
            })
        return JSONResponse(content={"version": 0, "entry_count": 0, "available": False})
    except Exception:
        return JSONResponse(content={"version": 0, "entry_count": 0, "available": False})


@app.get("/kb/export")
async def kb_export():
    db = get_mongo_db()
    if db is None:
        return JSONResponse(content={"version": 0, "entries": []})

    try:
        latest = await db.kb_snapshots.find_one(sort=[("version", -1)])
        if latest:
            return JSONResponse(content={
                "version": latest["version"],
                "generated_at": latest["generated_at"],
                "entries": latest["entries"],
            })
        return JSONResponse(content={"version": 0, "entries": []})
    except Exception:
        return JSONResponse(content={"version": 0, "entries": []})


@app.post("/kb/generate")
async def kb_generate_manual():
    """Manually trigger KB update generation."""
    asyncio.ensure_future(generate_kb_update("manual trigger", ""))
    return {"status": "triggered", "query_count": get_query_count()}


# ============ Legacy Sync Endpoint ============

@app.post("/sync")
async def sync_data(request: SyncRequest, user: dict | None = Depends(get_optional_current_user)):
    db = get_mongo_db()
    synced_convs = 0
    synced_telem = 0

    if db is not None:
        if request.conversations:
            for conv in request.conversations:
                conv["user_id"] = user["_id"] if user else None
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
        "timestamp": _now().isoformat(),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
