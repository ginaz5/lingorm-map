#!/usr/bin/env python3
"""One fixed source request for the guarded Actions collector.

The parent supplies a bounded JSON message through stdin. Response headers are
flushed before the body so the parent retains a known block if reading fails.
This helper does not own retries, source authorization, tokens, or publication.
"""

import json
from pathlib import Path
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
# Backstop only: the Node parent enforces the authoritative per-request cap
# (PYTHON_REQUEST_TIMEOUT_MS) and kills this process first.
REQUEST_TIMEOUT_SECONDS = 30
HEADER_NAMES = ("content-type", "cf-mitigated", "cf-ray", "retry-after")
MAPPING_PATH = Path(__file__).resolve().parent.parent / "data" / "superrich1965-branches.json"
MAPPING_LIMIT = 65_536
EXPECTED_BRANCH_COUNT = 38


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


def _load_allowed_branches():
    """Read only the checked-in mapping, failing closed before either request."""
    with MAPPING_PATH.open("rb") as source:
        raw = source.read(MAPPING_LIMIT + 1)
    if len(raw) > MAPPING_LIMIT:
        raise ValueError("invalid_mapping")
    mapping = _parse_json(raw.decode("utf-8"))
    if (
        not isinstance(mapping, dict)
        or set(mapping) != {"schemaVersion", "branches"}
        or type(mapping["schemaVersion"]) is not int
        or mapping["schemaVersion"] != 1
        or not isinstance(mapping["branches"], dict)
        or len(mapping["branches"]) != EXPECTED_BRANCH_COUNT
    ):
        raise ValueError("invalid_mapping")
    official_ids = set()
    allowed = set()
    for slug, branch in mapping["branches"].items():
        if not isinstance(branch, dict) or set(branch) != {"officialId", "branchNo", "companyCode"}:
            raise ValueError("invalid_mapping")
        official_id = branch["officialId"]
        branch_no = branch["branchNo"]
        company_code = branch["companyCode"]
        if (
            type(official_id) is not int
            or not 1 <= official_id <= 9_007_199_254_740_991
            or slug != "superrich1965-" + str(official_id)
            or official_id in official_ids
            or company_code != "A04"
            or not isinstance(branch_no, str)
            or re.fullmatch(r"[0-9]{2}", branch_no) is None
            or (company_code, branch_no) in allowed
        ):
            raise ValueError("invalid_mapping")
        official_ids.add(official_id)
        allowed.add((company_code, branch_no))
    return allowed


def _validated_rate_body(text, allowed):
    if not isinstance(text, str) or len(text.encode("utf-8")) > 4_096:
        raise ValueError("invalid_input")
    body = _parse_json(text)
    if (
        not isinstance(body, dict)
        or set(body) != {"filters"}
        or not isinstance(body["filters"], list)
        or len(body["filters"]) != 2
    ):
        raise ValueError("invalid_input")
    values = []
    for entry, field in zip(body["filters"], ("company_code", "branch_no")):
        if (
            not isinstance(entry, dict)
            or set(entry) != {"field", "value"}
            or entry["field"] != field
            or not isinstance(entry["value"], str)
        ):
            raise ValueError("invalid_input")
        values.append(entry["value"])
    if tuple(values) not in allowed:
        raise ValueError("invalid_input")
    return body


def prepare_request(raw):
    """Validate everything before constructing an opener or opening a socket."""
    if not isinstance(raw, bytes) or len(raw) > INPUT_LIMIT:
        raise ValueError("invalid_input")
    message = _parse_json(raw.decode("utf-8"))
    if not isinstance(message, dict):
        raise ValueError("invalid_input")
    allowed = _load_allowed_branches()
    if message == {"stage": "token"}:
        return urllib.request.Request(
            TOKEN_URL, method="GET", headers={"User-Agent": SAFARI_USER_AGENT}
        ), TOKEN_BODY_LIMIT
    if set(message) != {"stage", "token", "body"} or message["stage"] != "rate":
        raise ValueError("invalid_input")
    token = message["token"]
    if (
        not isinstance(token, str)
        or not 1 <= len(token) <= 16_384
        or re.fullmatch(r"[A-Za-z0-9._~+/\-]+={0,2}", token) is None
    ):
        raise ValueError("invalid_input")
    body = _validated_rate_body(message["body"], allowed)
    # Re-serialize with Python's normal spacing, matching the reviewed client.
    data = json.dumps(body).encode("utf-8")
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
