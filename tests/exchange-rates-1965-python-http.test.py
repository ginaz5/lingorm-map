"""Offline tests for the one-shot source HTTP helper; no source requests."""

import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request


SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "exchange-rates-1965-python-http.py"
SPEC = importlib.util.spec_from_file_location("exchange_rates_1965_python_http", SCRIPT)
HTTP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HTTP)


class Response:
    def __init__(self, status=200, headers=None, body=b"{}", error=None, before_read=None):
        self.status = status
        self.headers = headers or {}
        self.body = body
        self.error = error
        self.before_read = before_read
        self.read_limits = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True

    def read(self, limit):
        self.read_limits.append(limit)
        if self.before_read:
            self.before_read()
        if self.error:
            raise self.error
        return self.body[:limit]


class Opener:
    def __init__(self, response=None, error=None):
        self.response = response or Response()
        self.error = error
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        if self.error:
            raise self.error
        return self.response


def raw_message(message):
    return json.dumps(message).encode("utf-8")


def rate_message(**overrides):
    return {
        "stage": "rate",
        "token": "offline.example_token-123=",
        "body": json.dumps(HTTP.RATE_BODY, separators=(",", ":")),
        **overrides,
    }


class PythonHttpTests(unittest.TestCase):
    def run_main(self, raw, opener):
        output = io.StringIO()
        status = HTTP.main(io.BytesIO(raw), output, lambda: opener)
        return status, [json.loads(line) for line in output.getvalue().splitlines()]

    def test_token_get_matches_reviewed_safari_profile_without_extra_headers(self):
        opener = Opener(Response(body=b'{"accessToken":"offline-token"}'))
        status, events = self.run_main(raw_message({"stage": "token"}), opener)
        self.assertEqual(status, 0)
        request, timeout = opener.requests[0]
        self.assertEqual(request.full_url, HTTP.TOKEN_URL)
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertEqual(request.header_items(), [("User-agent", HTTP.SAFARI_USER_AGENT)])
        self.assertEqual(HTTP.SAFARI_USER_AGENT, (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        ))
        self.assertEqual(timeout, 12)
        self.assertEqual(events, [
            {"event": "headers", "status": 200, "headers": {}},
            {"event": "body", "body": '{"accessToken":"offline-token"}'},
        ])

    def test_rate_post_uses_only_fixed_headers_and_python_json_spacing(self):
        opener = Opener()
        status, _ = self.run_main(raw_message(rate_message()), opener)
        self.assertEqual(status, 0)
        request, timeout = opener.requests[0]
        self.assertEqual(request.full_url, HTTP.RATE_URL)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.data, json.dumps(HTTP.RATE_BODY).encode("utf-8"))
        self.assertEqual(dict(request.header_items()), {
            "User-agent": HTTP.SAFARI_USER_AGENT,
            "Authorization": "Bearer offline.example_token-123=",
            "Content-type": "application/json",
            "Referer": "https://www.superrich1965.com/",
        })
        self.assertEqual(timeout, HTTP.REQUEST_TIMEOUT_SECONDS)

    def test_headers_are_flushed_before_success_body_read(self):
        output = io.StringIO()
        response = Response(before_read=lambda: self.assertEqual(
            output.getvalue(), '{"event":"headers","status":200,"headers":{}}\n'
        ))
        self.assertEqual(HTTP.main(io.BytesIO(b'{"stage":"token"}'), output, lambda: Opener(response)), 0)
        self.assertTrue(response.closed)

    def test_http_error_403_returns_metadata_without_reading_body(self):
        error = urllib.error.HTTPError(
            HTTP.TOKEN_URL, 403, "sensitive exception text", {"cf-mitigated": "challenge"},
            io.BytesIO(b"sensitive HTML body"),
        )
        with patch.object(error, "read", side_effect=AssertionError("must not read block HTML")) as read:
            status, events = self.run_main(b'{"stage":"token"}', Opener(error=error))
        self.assertEqual(status, 0)
        self.assertEqual(events, [
            {"event": "headers", "status": 403, "headers": {"cf-mitigated": "challenge"}},
            {"event": "body", "body": ""},
        ])
        read.assert_not_called()

    def test_all_non_success_and_challenge_responses_skip_body(self):
        for status, headers in [(302, {}), (429, {}), (500, {}), (200, {"cf-mitigated": "CHALLENGE"})]:
            with self.subTest(status=status, headers=headers):
                response = Response(status, headers, error=TimeoutError("private"))
                code, events = self.run_main(b'{"stage":"token"}', Opener(response))
                self.assertEqual(code, 0)
                self.assertEqual(events[-1], {"event": "body", "body": ""})
                self.assertEqual(response.read_limits, [])

    def test_200_body_error_preserves_headers_without_exception_text(self):
        response = Response(headers={"cf-ray": "offline-ray"}, error=TimeoutError("private token body"))
        status, events = self.run_main(b'{"stage":"token"}', Opener(response))
        self.assertEqual(status, 1)
        self.assertEqual(events, [
            {"event": "headers", "status": 200, "headers": {"cf-ray": "offline-ray"}},
            {"event": "error"},
        ])
        self.assertTrue(response.closed)

    def test_preheader_exception_emits_only_fixed_error(self):
        output = io.StringIO()
        with patch("sys.stderr", new_callable=io.StringIO) as stderr:
            status = HTTP.main(io.BytesIO(b'{"stage":"token"}'), output,
                               lambda: Opener(error=OSError("private token credentials")))
        self.assertEqual(status, 1)
        self.assertEqual(output.getvalue(), '{"event":"error"}\n')
        self.assertEqual(stderr.getvalue(), "")

    def test_response_header_allowlist_strips_controls_and_bounds_values(self):
        response = Response(headers={
            "content-type": "application/json\r\n\x00",
            "cf-mitigated": "challenge",
            "cf-ray": "x" * 150,
            "retry-after": "10\n",
            "set-cookie": "private-cookie",
            "authorization": "private-token",
        })
        _, events = self.run_main(b'{"stage":"token"}', Opener(response))
        self.assertEqual(events[0]["headers"], {
            "content-type": "application/json", "cf-mitigated": "challenge",
            "cf-ray": "x" * 100, "retry-after": "10",
        })

    def test_proxy_discovery_redirects_and_cookies_are_disabled(self):
        with patch.object(urllib.request, "build_opener") as build:
            HTTP.create_opener()
        proxy, redirects = build.call_args.args
        self.assertIsInstance(proxy, urllib.request.ProxyHandler)
        self.assertEqual(proxy.proxies, {})
        self.assertIsInstance(redirects, HTTP.NoRedirectHandler)
        self.assertIsNone(redirects.redirect_request(None, None, 302, None, None, "https://outside.invalid/"))
        with patch.dict("os.environ", {"HTTPS_PROXY": "http://outside.invalid/"}):
            opener = HTTP.create_opener()
        self.assertFalse(any(isinstance(handler, urllib.request.HTTPCookieProcessor) for handler in opener.handlers))
        redirect_handlers = [handler for handler in opener.handlers if isinstance(handler, urllib.request.HTTPRedirectHandler)]
        self.assertEqual(len(redirect_handlers), 1)
        self.assertIsInstance(redirect_handlers[0], HTTP.NoRedirectHandler)

    def test_invalid_input_cannot_construct_opener(self):
        invalid = [
            b"", b"[]", b"null", b"true", b"not json", b"\xff",
            b'{"stage":"token","stage":"token"}',
            b'{"stage":"token","url":"https://outside.invalid/"}',
            raw_message({"stage": "rate"}),
            raw_message(rate_message(url="https://outside.invalid/")),
            raw_message(rate_message(token="private\r\nHeader: value")),
            raw_message(rate_message(token="")),
            raw_message(rate_message(token="x" * 16_385)),
            raw_message(rate_message(token=True)),
            raw_message(rate_message(body="[]")),
            raw_message(rate_message(body=json.dumps({"filters": [
                {"field": "company_code", "value": "A04"},
                {"field": "branch_no", "value": "56"},
            ]}))),
            raw_message(rate_message(body='{"filters":[],"filters":[]}')),
            raw_message(rate_message(body=" " * 4_097)),
            b" " * (HTTP.INPUT_LIMIT + 1),
        ]
        for raw in invalid:
            with self.subTest(raw_length=len(raw)):
                opener_factory = unittest.mock.Mock(side_effect=AssertionError("must not construct opener"))
                output = io.StringIO()
                self.assertEqual(HTTP.main(io.BytesIO(raw), output, opener_factory), 1)
                self.assertEqual(output.getvalue(), '{"event":"error"}\n')
                opener_factory.assert_not_called()

    def test_success_body_limit_and_utf8_replacement(self):
        for message, limit in [({"stage": "token"}, HTTP.TOKEN_BODY_LIMIT), (rate_message(), HTTP.RATE_BODY_LIMIT)]:
            with self.subTest(limit=limit):
                response = Response(body=b"x" * (limit + 1))
                status, events = self.run_main(raw_message(message), Opener(response))
                self.assertEqual(status, 1)
                self.assertEqual(events[-1], {"event": "error"})
                self.assertEqual(response.read_limits, [limit + 1])
        status, events = self.run_main(b'{"stage":"token"}', Opener(Response(body=b"\xff")))
        self.assertEqual(status, 0)
        self.assertEqual(events[-1], {"event": "body", "body": "\ufffd"})

    def test_input_read_is_bounded(self):
        stream = unittest.mock.Mock()
        stream.read.return_value = b" " * (HTTP.INPUT_LIMIT + 1)
        self.assertEqual(HTTP.main(stream, io.StringIO()), 1)
        stream.read.assert_called_once_with(HTTP.INPUT_LIMIT + 1)


if __name__ == "__main__":
    unittest.main()
