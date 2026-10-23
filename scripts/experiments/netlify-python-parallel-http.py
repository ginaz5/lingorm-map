#!/usr/bin/env python3
"""Isolated 38-way probe; one token GET, then one request per fixed branch.

Only the parent process sees response bodies. Tokens never leave this process.
The parent must explicitly authorize the fan-out after checking its source lease.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.error

HELPER = Path(__file__).resolve().parent.parent / "exchange-rates-1965-python-http.py"
SPEC = importlib.util.spec_from_file_location("fixed_source_http", HELPER)
HTTP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HTTP)
SLUGS = json.loads(HTTP.MAPPING_PATH.read_text())["branches"]


def clock_ms():
    return int(time.time() * 1000)


def reason_for(error):
    detail = error.reason if isinstance(error, urllib.error.URLError) else error
    return "timeout" if isinstance(detail, (TimeoutError, socket.timeout)) else "http_error"


def token_value(body, now_ms):
    payload = HTTP._parse_json(body)
    token = payload.get("accessToken") if isinstance(payload, dict) else None
    # Reuse the original helper's credential and fixed-payload validation.
    branch = next(iter(SLUGS.values()))
    HTTP.prepare_request(json.dumps({"stage": "rate", "token": token, "body": json.dumps({"filters": [
        {"field": "company_code", "value": branch["companyCode"]},
        {"field": "branch_no", "value": branch["branchNo"]},
    ]})}).encode())
    hints = []
    expires_in = payload.get("expires_in")
    if type(expires_in) in (int, float):
        hints.append(now_ms + expires_in * 1000)
    if token.count(".") == 2:
        try:
            middle = token.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(middle + "=" * (-len(middle) % 4)))
            if type(claims.get("exp")) in (int, float):
                hints.append(claims["exp"] * 1000)
        except (ValueError, TypeError, KeyError):
            pass
    # The batch needs the unchanged 30-second safety margin plus its 15s budget.
    if hints and min(hints) <= now_ms + 45_000:
        raise ValueError("near_expiry_token")
    return token


def run_probe(emit, authorize_rates, opener_factory=HTTP.create_opener):
    HTTP._load_allowed_branches()  # Validate the complete inventory before HTTP.
    token_started = clock_ms()
    token_events = []

    def observe_token(event):
        token_events.append(event)
        if event["event"] == "headers":
            emit({**event, "stage": "token", "startedAtMs": token_started})

    try:
        emit({"event": "token_started", "startedAtMs": token_started})
        HTTP.execute_request(b'{"stage":"token"}', observe_token, opener_factory)
        headers = next(row for row in token_events if row["event"] == "headers")
        if not 200 <= headers["status"] < 300 or headers["headers"].get("cf-mitigated", "").lower() == "challenge":
            emit({"event": "token_result", "reason": "http_error", "completedAtMs": clock_ms()})
            emit({"event": "done", "ratePosts": 0})
            return
        body = next(row["body"] for row in token_events if row["event"] == "body")
        token = token_value(body, clock_ms())
    except Exception as error:
        reason = "near_expiry_token" if isinstance(error, ValueError) and str(error) == "near_expiry_token" else reason_for(error)
        emit({"event": "token_result", "reason": reason, "completedAtMs": clock_ms()})
        emit({"event": "done", "ratePosts": 0})
        return
    emit({"event": "token_result", "reason": None, "completedAtMs": clock_ms()})
    emit({"event": "ready", "requested": len(SLUGS)})
    if not authorize_rates():
        emit({"event": "done", "ratePosts": 0})
        return

    barrier = threading.Barrier(38, timeout=5)

    def request_rate(item):
        slug, branch = item
        message = json.dumps({"stage": "rate", "token": token, "body": json.dumps({"filters": [
            {"field": "company_code", "value": branch["companyCode"]},
            {"field": "branch_no", "value": branch["branchNo"]},
        ]})}).encode()
        HTTP.prepare_request(message)  # All fields remain fixed and allowlisted.
        events = []
        barrier.wait()
        started = clock_ms()
        emit({"event": "started", "slug": slug, "startedAtMs": started})

        def observe(event):
            events.append(event)
            if event["event"] == "headers":
                emit({**event, "stage": "rate", "slug": slug})

        try:
            HTTP.execute_request(message, observe, opener_factory)
            body = next(row["body"] for row in events if row["event"] == "body")
            emit({"event": "result", "slug": slug, "body": body, "reason": None,
                  "completedAtMs": clock_ms()})
        except Exception as error:
            emit({"event": "result", "slug": slug, "body": "", "reason": reason_for(error),
                  "completedAtMs": clock_ms()})

    with ThreadPoolExecutor(max_workers=38) as executor:
        list(executor.map(request_rate, SLUGS.items()))
    emit({"event": "done", "ratePosts": 38})


def main():
    output_lock = threading.Lock()

    def emit(event):
        with output_lock:
            sys.stdout.write(json.dumps(event, separators=(",", ":")) + "\n")
            sys.stdout.flush()

    try:
        if len(sys.argv) != 1 or sys.stdin.buffer.readline(1024) != b'{"operation":"parallel38"}\n':
            raise ValueError("invalid_input")
        run_probe(emit, lambda: sys.stdin.buffer.readline(1024) == b'{"action":"rates"}\n')
        return 0
    except (Exception, KeyboardInterrupt):
        emit({"event": "error"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
