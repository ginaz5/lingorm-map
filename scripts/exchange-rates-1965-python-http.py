#!/usr/bin/env python3
"""One fixed source request for the guarded Actions collector.

The parent supplies a bounded JSON message through stdin. Response headers are
flushed before the body so the parent retains a known block if reading fails.
This helper does not own retries, source authorization, tokens, or publication.
"""

import json
import re
import sys
import urllib.error
import urllib.request


TOKEN_URL = "https://api.superrich1965.com/front/exchange-rate/oauth2/callback"
RATE_URL = (
    "https://www.superrich1965.com/api/exchange-rate-service/v1/"
    "external-app-exchange-rate/get"
)
# ThaiCash's reviewed cafce7f3bbd20d77306a82364e61f349a4e2e45e profile.
SAFARI_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
INPUT_LIMIT = 32_768
TOKEN_BODY_LIMIT = 65_536
RATE_BODY_LIMIT = 1_048_576
REQUEST_TIMEOUT_SECONDS = 12
HEADER_NAMES = ("content-type", "cf-mitigated", "cf-ray", "retry-after")
RATE_BODY = {
    "filters": [
        {"field": "company_code", "value": "A04"},
        {"field": "branch_no", "value": "36"},
    ]
}


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Return the original redirect as an HTTP error; never follow it."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("invalid_input")
        result[key] = value
    return result


def _parse_json(text):
    return json.loads(text, object_pairs_hook=_unique_object)


def prepare_request(raw):
    """Validate everything before constructing an opener or opening a socket."""
    if not isinstance(raw, bytes) or len(raw) > INPUT_LIMIT:
        raise ValueError("invalid_input")
    message = _parse_json(raw.decode("utf-8"))
    if not isinstance(message, dict):
        raise ValueError("invalid_input")
    if message == {"stage": "token"}:
        return urllib.request.Request(
            TOKEN_URL, method="GET", headers={"User-Agent": SAFARI_USER_AGENT}
        ), TOKEN_BODY_LIMIT
    if set(message) != {"stage", "token", "body"} or message["stage"] != "rate":
        raise ValueError("invalid_input")
    token = message["token"]
    body = message["body"]
    if (
        not isinstance(token, str)
        or not 1 <= len(token) <= 16_384
        or re.fullmatch(r"[A-Za-z0-9._~+/\-]+={0,2}", token) is None
        or not isinstance(body, str)
        or len(body.encode("utf-8")) > 4_096
        or _parse_json(body) != RATE_BODY
    ):
        raise ValueError("invalid_input")
    # Re-serialize with Python's normal spacing, matching the reviewed client.
    data = json.dumps(RATE_BODY).encode("utf-8")
    return urllib.request.Request(
        RATE_URL,
        method="POST",
        data=data,
        headers={
            "User-Agent": SAFARI_USER_AGENT,
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Referer": "https://www.superrich1965.com/",
        },
    ), RATE_BODY_LIMIT


def create_opener():
    # Explicitly disable environment proxy discovery and every redirect. The
    # default HTTPS handler keeps certificate and hostname verification enabled.
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirectHandler()
    )


def response_metadata(response):
    status = response.status
    if isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599:
        raise ValueError("invalid_response")
    headers = {}
    for name in HEADER_NAMES:
        value = response.headers.get(name)
        if value is not None:
            headers[name] = re.sub(r"[^\x20-\x7e]", "", str(value))[:100]
    return {"event": "headers", "status": status, "headers": headers}


def execute_request(raw, emit, opener_factory=create_opener):
    """Emit two JSON events; errors are handled by main without exception text."""
    request, body_limit = prepare_request(raw)
    opener = opener_factory()
    try:
        response = opener.open(request, timeout=REQUEST_TIMEOUT_SECONDS)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        metadata = response_metadata(response)
        emit(metadata)
        if (
            not 200 <= metadata["status"] < 300
            or metadata["headers"].get("cf-mitigated", "").lower() == "challenge"
        ):
            # Error HTML is not needed to classify a block and may never finish.
            emit({"event": "body", "body": ""})
            return
        body = response.read(body_limit + 1)
        if not isinstance(body, bytes) or len(body) > body_limit:
            raise ValueError("invalid_response")
        emit({"event": "body", "body": body.decode("utf-8", errors="replace")})


def emit_event(event, output):
    output.write(json.dumps(event, ensure_ascii=True, separators=(",", ":")) + "\n")
    output.flush()


def main(input_stream=None, output=None, opener_factory=create_opener):
    input_stream = sys.stdin.buffer if input_stream is None else input_stream
    output = sys.stdout if output is None else output
    try:
        raw = input_stream.read(INPUT_LIMIT + 1)
        execute_request(raw, lambda event: emit_event(event, output), opener_factory)
        return 0
    except (Exception, KeyboardInterrupt):
        # Never include token, body, URL, or the underlying exception in logs.
        try:
            emit_event({"event": "error"}, output)
        except Exception:
            pass
        return 1


if __name__ == "__main__":
    if len(sys.argv) != 1:
        emit_event({"event": "error"}, sys.stdout)
        sys.exit(1)
    sys.exit(main())
