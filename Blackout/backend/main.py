"""
Blackout Backend - FastAPI Application
Handles: Gemini API, MongoDB Atlas, Arize Phoenix, KB auto-update
"""
import os
import time
import json
import math
import hashlib
from datetime import datetime, timezone

def _now():
    return datetime.now(timezone.utc)
from collections import Counter
import asyncio
import httpx

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

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
    span_id: str | None = None
    trace_id: str | None = None

class ChatOfflineRequest(BaseModel):
    query: str
    history: list[dict] = []

class FeedbackRequest(BaseModel):
    span_id: str
    trace_id: str
    label: str  # "thumbs-up" or "thumbs-down"
    score: float  # 1.0 or 0.0
    comment: str | None = None

class SyncRequest(BaseModel):
    conversations: list[dict] = []
    telemetry: list[dict] = []

# ============ Configuration ============

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MONGODB_URI = os.getenv("MONGODB_URI", "")
PHOENIX_API_KEY = os.getenv("PHOENIX_API_KEY", "")
KB_UPDATE_INTERVAL = int(os.getenv("KB_UPDATE_INTERVAL", "10"))

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
        return tracer_provider
    except ImportError:
        print("Phoenix not installed. Run: pip install arize-phoenix-otel openinference-instrumentation")
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
async def chat(request: ChatRequest):
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
            })

        asyncio.ensure_future(maybe_trigger_kb_update(request.query, text, latency))
        asyncio.ensure_future(_evaluate_response_quality(span_id or "", request.query, text, latency, "online"))

        return ChatResponse(response=text, model="Gemini 2.5 Flash Lite", latency_ms=latency, span_id=span_id, trace_id=trace_id)
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

@app.post("/chat/offline", response_model=ChatResponse)
async def chat_offline(request: ChatOfflineRequest):
    start = time.time()
    tracer = get_tracer()

    try:
        if tracer:
            with tracer.start_as_current_span("chat_offline") as span:
                span.set_attribute("query", request.query[:500])
                span.set_attribute("history_length", len(request.history))

                async with httpx.AsyncClient(timeout=60) as client:
                    messages = [{"role": "system", "content": "You are Blackout AI, a helpful offline assistant. Be concise and direct."}]
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
                sc = span.get_span_context()
                span_id = format(sc.span_id, "016x")
                trace_id = format(sc.trace_id, "032x")
        else:
            async with httpx.AsyncClient(timeout=60) as client:
                messages = [{"role": "system", "content": "You are Blackout AI, a helpful offline assistant. Be concise and direct."}]
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

        return ChatResponse(response=text, model="Gemma 2 2B (Local)", latency_ms=latency, span_id=span_id, trace_id=trace_id)
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

        # Queue KB improvement if thumbs-down
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

        # 1. Response length quality
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

        # 2. Latency quality
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

        # 3. Query intent match (basic keyword overlap)
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

        # Use Gemini to generate a Q&A pair from trending topics
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

        # Compile and store the full KB snapshot
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

        # Trim old snapshots
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


# ============ Sync Endpoints ============

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
        "timestamp": _now().isoformat(),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
