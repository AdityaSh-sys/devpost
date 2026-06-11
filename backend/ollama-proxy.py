"""
Blackout Ollama Proxy
Bridges local Ollama to the deployed frontend via CORS-enabled HTTP proxy.

Usage:
    python ollama-proxy.py              # Listen on port 8081
    python ollama-proxy.py --port 9090  # Custom port
    python ollama-proxy.py --ollama-url http://localhost:11434

The proxy forwards all requests to Ollama and adds CORS headers
so the deployed Vercel frontend can reach your local Ollama.
"""

import json
import sys
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError
from urllib.parse import urljoin

OLLAMA_URL = "http://localhost:11434"
PROXY_PORT = 8081

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "86400",
}


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]} {args[1]} {args[2]}")

    def _set_cors(self):
        for key, value in CORS_HEADERS.items():
            self.send_header(key, value)

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_GET(self):
        self._proxy_request("GET")

    def do_POST(self):
        self._proxy_request("POST")

    def do_HEAD(self):
        self._proxy_request("HEAD")

    def _proxy_request(self, method):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        target = urljoin(OLLAMA_URL, self.path)
        req = Request(target, data=body, method=method)

        if body and self.headers.get("Content-Type"):
            req.add_header("Content-Type", self.headers["Content-Type"])

        try:
            resp = urlopen(req, timeout=60)
            resp_body = resp.read()

            self.send_response(resp.status)
            self._set_cors()
            self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)

        except URLError as e:
            status = getattr(e, "code", 502)
            msg = str(e.reason) if hasattr(e, "reason") else str(e)
            self.send_response(status)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            body = json.dumps({"error": msg}).encode()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.send_response(502)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            body = json.dumps({"error": str(e)}).encode()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Blackout Ollama Proxy")
    parser.add_argument("--port", type=int, default=PROXY_PORT, help=f"Proxy port (default: {PROXY_PORT})")
    parser.add_argument("--ollama-url", default=OLLAMA_URL, help=f"Ollama URL (default: {OLLAMA_URL})")
    args = parser.parse_args()

    global OLLAMA_URL, PROXY_PORT
    OLLAMA_URL = args.ollama_url.rstrip("/")
    PROXY_PORT = args.port

    server = HTTPServer(("0.0.0.0", PROXY_PORT), ProxyHandler)
    print(f"\n  Blackout Ollama Proxy running on http://localhost:{PROXY_PORT}")
    print(f"  Forwarding to Ollama at {OLLAMA_URL}")
    print(f"  CORS enabled — accessible from any origin")
    print(f"\n  Keep this running alongside Ollama.")
    print(f"  Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
