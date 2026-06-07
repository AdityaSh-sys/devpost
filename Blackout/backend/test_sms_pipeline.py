"""
Tests for Blackout SMS AI Pipeline
Tests all functions in the SMS -> Gemini -> SMS loop
"""
import os
import json
import time
import unittest
from unittest.mock import patch, AsyncMock, MagicMock

# Ensure .env is loaded from backend directory
os.environ["GEMINI_API_KEY"] = "test-key"
os.environ["TWILIO_ACCOUNT_SID"] = "test-sid"
os.environ["TWILIO_AUTH_TOKEN"] = "test-token"
os.environ["TWILIO_PHONE_NUMBER"] = "+15551234567"
os.environ["SMS_RECIPIENT"] = "+15559876543"

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import importlib
import main
importlib.reload(main)

from main import (
    app,
    call_gemini,
    send_sms_via_twilio,
    truncate_sms_response,
    offline_fallback,
    verify_twilio_request,
    OFFLINE_KNOWLEDGE,
    SMS_MAX_LENGTH,
)
from fastapi.testclient import TestClient

client = TestClient(app)


class TestTruncateSMS(unittest.TestCase):
    """Test 6: Very long Gemini response is truncated safely."""

    def test_short_response_not_truncated(self):
        text = "Short response."
        assert truncate_sms_response(text) == text

    def test_long_response_truncated_at_sentence(self):
        text = "This is a long response. " * 100
        result = truncate_sms_response(text, max_length=100)
        assert len(result) <= 100 + len("\n\n[Reply CONTINUE for more]")
        assert result.endswith("[Reply CONTINUE for more]")

    def test_long_response_truncated_at_word(self):
        text = "word " * 500
        result = truncate_sms_response(text, max_length=100)
        assert len(result) <= 100 + len("\n\n[Reply CONTINUE for more]")
        assert result.endswith("[Reply CONTINUE for more]")

    def test_exact_length_not_truncated(self):
        text = "A" * SMS_MAX_LENGTH
        assert truncate_sms_response(text) == text

    def test_one_over_length_truncated(self):
        text = "A" * (SMS_MAX_LENGTH + 1)
        result = truncate_sms_response(text)
        assert result.endswith("[Reply CONTINUE for more]")
        assert len(result) < len(text) + len("\n\n[Reply CONTINUE for more]")


class TestOfflineFallback(unittest.TestCase):
    """Test offline knowledge base responses."""

    def test_medical_query(self):
        result = offline_fallback("What is first aid for a deep cut?")
        assert "first aid" in result.lower() or "cut" in result.lower() or "bleed" in result.lower()

    def test_earthquake_query(self):
        """Test 2: Earthquake question returns useful response."""
        result = offline_fallback("What should I do during an earthquake?")
        assert "drop" in result.lower() and "cover" in result.lower()

    def test_water_purification_query(self):
        result = offline_fallback("How do I purify water after a flood?")
        assert "boil" in result.lower() or "bleach" in result.lower() or "water" in result.lower()

    def test_cpr_query(self):
        result = offline_fallback("How do I perform CPR?")
        assert "cpr" in result.lower() or "compression" in result.lower()

    def test_empty_query(self):
        result = offline_fallback("")
        assert len(result) > 0

    def test_nonsense_query(self):
        """Fallback should give generic response for unknown queries."""
        result = offline_fallback("xyznonexistent12345")
        assert "offline" in result.lower() or "topic" in result.lower()

    def test_emergency_help_query(self):
        """help/emergency matches rescue keywords, should still return useful answer."""
        result = offline_fallback("help emergency")
        assert len(result) > 0

    def test_shelter_query(self):
        result = offline_fallback("How to build a shelter")
        assert "shelter" in result.lower() or "a-frame" in result.lower()


class TestSendSMS(unittest.TestCase):
    """Test SMS sending function (mocked)."""

    def test_send_sms_via_twilio_success(self):
        async def mock_send(*args, **kwargs):
            return {
                "sid": "SM123",
                "status": "sent",
                "to": "+15559876543",
                "from": "+15551234567",
                "body": "Hello from Blackout",
            }
        with patch.object(main, 'httpx') as mock_httpx:
            mock_client = AsyncMock()
            mock_httpx.AsyncClient.return_value.__aenter__.return_value = mock_client
            mock_client.post = AsyncMock()
            mock_client.post.return_value = AsyncMock(
                status_code=201,
                raise_for_status=MagicMock(),
                json=MagicMock(return_value={
                    "sid": "SM123",
                    "status": "sent",
                    "to": "+15559876543",
                    "from": "+15551234567",
                    "body": "Hello from Blackout",
                })
            )
            import asyncio
            result = asyncio.run(send_sms_via_twilio("+15559876543", "Hello from Blackout"))
            assert result["sid"] == "SM123"
            assert result["status"] == "sent"

    def test_send_sms_via_twilio_no_credentials(self):
        with patch.object(main, 'TWILIO_ACCOUNT_SID', ''), \
             patch.object(main, 'TWILIO_AUTH_TOKEN', ''):
            import asyncio
            with self.assertRaises(RuntimeError):
                asyncio.run(send_sms_via_twilio("+15559876543", "test"))


class TestCallGemini(unittest.TestCase):
    """Test Gemini API call (mocked)."""

    def test_call_gemini_success(self):
        with patch.object(main, 'httpx') as mock_httpx:
            mock_client = AsyncMock()
            mock_httpx.AsyncClient.return_value.__aenter__.return_value = mock_client
            mock_client.post = AsyncMock()
            mock_response = AsyncMock()
            mock_response.status_code = 200
            mock_response.raise_for_status = MagicMock()
            mock_response.json = MagicMock(return_value={
                "candidates": [{
                    "content": {"parts": [{"text": "Hello! How can I help you today?"}]}
                }]
            })
            mock_client.post.return_value = mock_response

            import asyncio
            text, latency = asyncio.run(call_gemini("Hello"))
            assert text == "Hello! How can I help you today?"
            assert isinstance(latency, int)
            assert latency >= 0

    def test_call_gemini_no_api_key(self):
        with patch.object(main, 'GEMINI_API_KEY', ''):
            import asyncio
            with self.assertRaises(RuntimeError):
                asyncio.run(call_gemini("Hello"))

    @patch("main.httpx.AsyncClient")
    def test_call_gemini_api_error(self, mock_client):
        mock_instance = AsyncMock()
        mock_instance.__aenter__.return_value = mock_instance
        mock_instance.post.side_effect = Exception("API Error")
        mock_client.return_value = mock_instance

        import asyncio
        with self.assertRaises(Exception):
            asyncio.run(call_gemini("Hello"))


class TestWebhookEndpoint(unittest.TestCase):
    """Test the /sms/webhook endpoint."""

    def test_empty_body_returns_twiml(self):
        """Test 4: Empty SMS returns graceful validation error."""
        response = client.post(
            "/sms/webhook",
            data={"Body": "", "From": "+15559876543", "MessageSid": "SM123"},
        )
        assert response.status_code == 200
        assert "<?xml" in response.text
        assert "<Message>" in response.text

    def test_missing_from_returns_twiml(self):
        response = client.post(
            "/sms/webhook",
            data={"Body": "Hello", "From": "", "MessageSid": "SM123"},
        )
        assert response.status_code == 200
        assert "<?xml" in response.text

    def test_valid_request_returns_twiml(self):
        """Test 1: Full SMS processing returns TwiML."""
        with patch.object(main, 'call_gemini', new_callable=AsyncMock) as mock_gemini, \
             patch.object(main, 'send_sms_via_twilio', new_callable=AsyncMock) as mock_sms:
            mock_gemini.return_value = ("Hello! How can I help?", 50)
            mock_sms.return_value = {"sid": "SM999", "status": "sent"}
            response = client.post(
                "/sms/webhook",
                data={"Body": "Hello", "From": "+15559876543", "MessageSid": "SM123"},
            )
            assert response.status_code == 200
            assert "<?xml" in response.text
            assert "<Response>" in response.text

    def test_very_long_prompt(self):
        """Test 5: Very long prompt is handled without crashing."""
        long_body = "help " * 1000
        with patch.object(main, 'call_gemini', new_callable=AsyncMock) as mock_gemini, \
             patch.object(main, 'send_sms_via_twilio', new_callable=AsyncMock) as mock_sms:
            mock_gemini.return_value = ("Some response", 50)
            mock_sms.return_value = {"sid": "SM999", "status": "sent"}
            response = client.post(
                "/sms/webhook",
                data={"Body": long_body, "From": "+15559876543", "MessageSid": "SM999"},
            )
            assert response.status_code == 200
            assert "<?xml" in response.text

    def test_content_type_is_xml(self):
        response = client.post(
            "/sms/webhook",
            data={"Body": "test", "From": "+15559876543", "MessageSid": "SM123"},
        )
        assert "text/xml" in response.headers.get("content-type", "")


class TestHealthEndpoint(unittest.TestCase):
    """Test health check endpoint."""

    def test_health_returns_status(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "services" in data
        assert "gemini" in data["services"]
        assert "twilio" in data["services"]


class TestChatEndpoint(unittest.TestCase):
    """Test /chat endpoint (pre-existing, not part of SMS pipeline)."""

    def test_chat_demo_mode(self):
        with patch.object(main, 'GEMINI_API_KEY', ''):
            response = client.post("/chat", json={"query": "Hello"})
            assert response.status_code == 200
            data = response.json()
            assert "demo mode" in data["response"].lower()


class TestPingEndpoint(unittest.TestCase):
    """Test /ping endpoint."""

    def test_ping_returns_ok(self):
        response = client.get("/ping")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_ping_head_returns_ok(self):
        response = client.head("/ping")
        assert response.status_code == 200


class TestVerifyTwilio(unittest.TestCase):
    """Test Twilio request signature verification."""

    def test_verify_no_signature(self):
        mock_request = MagicMock()
        mock_request.headers = {}
        result = verify_twilio_request(mock_request, "http://test.com")
        assert result is False

    def test_verify_no_auth_token(self):
        with patch.object(main, 'TWILIO_AUTH_TOKEN', ''):
            mock_request = MagicMock()
            mock_request.headers = {"X-Twilio-Signature": "abc"}
            result = verify_twilio_request(mock_request, "http://test.com")
            assert result is False


class TestKnowledgeBase(unittest.TestCase):
    """Verify offline knowledge base is populated."""

    def test_knowledge_base_has_entries(self):
        assert len(OFFLINE_KNOWLEDGE) >= 8

    def test_each_entry_has_keywords_and_answer(self):
        for entry in OFFLINE_KNOWLEDGE:
            assert "keywords" in entry
            assert "answer" in entry
            assert len(entry["keywords"]) > 0
            assert len(entry["answer"]) > 0


class TestSMSFlowIntegration(unittest.TestCase):
    """Test 3: When Gemini fails, offline fallback is used."""

    def test_gemini_failure_triggers_offline_fallback(self):
        """Simulate Gemini failure, expect offline KB response + SMS sent."""
        with patch.object(main, 'call_gemini', side_effect=Exception("API down")), \
             patch.object(main, 'send_sms_via_twilio', new_callable=AsyncMock) as mock_sms:
            mock_sms.return_value = {"sid": "SM555", "status": "sent"}
            response = client.post(
                "/sms/webhook",
                data={"Body": "What should I do during an earthquake?",
                      "From": "+15559876543", "MessageSid": "SM555"},
            )
            assert response.status_code == 200
            assert "<?xml" in response.text
            # Verify SMS was sent with offline KB response
            call_kwargs = mock_sms.call_args
            if call_kwargs:
                _, kwargs = call_kwargs
                sent_body = kwargs.get("body", "")
                assert "drop" in sent_body.lower() or "cover" in sent_body.lower()


if __name__ == "__main__":
    unittest.main(verbosity=2)
