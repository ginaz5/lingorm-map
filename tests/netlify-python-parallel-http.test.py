"""Offline proof of 38 simultaneous requests, one token and zero retries."""
import base64
import importlib.util
import json
from pathlib import Path
import threading
import time
import unittest
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("parallel_http", ROOT / "scripts/experiments/netlify-python-parallel-http.py")
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)
FIXTURE = (ROOT / "tests/fixtures/superrich1965/exchange-rate-00.json").read_bytes()


class Response:
    def __init__(self, body, status=200, headers=None, close=lambda: None):
        self.body, self.status, self.headers = body, status, headers or {}
        self.close = close

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def read(self, limit):
        return self.body[:limit]


class ParallelHttpTests(unittest.TestCase):
    def harness(self, *, token_status=200, lifetime=3600, fail_branch=None, authorize=True):
        lock = threading.Lock()
        ready = threading.Event()
        state = {"requests": [], "active": 0, "peak": 0}
        claims = base64.urlsafe_b64encode(json.dumps({"exp": time.time() + lifetime}).encode()).decode().rstrip("=")
        token = "e30." + claims + ".offline"

        class Opener:
            def open(self, request, timeout):
                with lock:
                    state["requests"].append((request, timeout))
                if request.get_method() == "GET":
                    return Response(json.dumps({"accessToken": token}).encode(), token_status)
                with lock:
                    state["active"] += 1
                    state["peak"] = max(state["peak"], state["active"])
                    if state["active"] == 38:
                        ready.set()
                if not ready.wait(5):
                    raise TimeoutError()

                def close():
                    with lock:
                        state["active"] -= 1

                body = json.loads(request.data)
                if body["filters"][1]["value"] == fail_branch:
                    close()
                    raise urllib.error.URLError(TimeoutError())
                return Response(FIXTURE, headers={"content-type": "application/json"}, close=close)

        events = []
        PROBE.run_probe(lambda e: events.append(e), lambda: authorize, Opener)
        return state, events, token

    def test_38_requests_really_overlap_and_each_uses_its_own_mapping(self):
        state, events, token = self.harness()
        self.assertEqual(len(state["requests"]), 39)
        self.assertEqual(state["peak"], 38)
        self.assertEqual(state["active"], 0)
        self.assertEqual(sum(r.get_method() == "GET" for r, _ in state["requests"]), 1)
        rates = [(r, t) for r, t in state["requests"] if r.get_method() == "POST"]
        self.assertEqual({json.loads(r.data)["filters"][1]["value"] for r, _ in rates},
                         {b["branchNo"] for b in PROBE.SLUGS.values()})
        self.assertTrue(all(t == 30 for _, t in rates))
        self.assertTrue(all(r.full_url == PROBE.HTTP.RATE_URL for r, _ in rates))
        self.assertEqual(len([e for e in events if e["event"] == "result"]), 38)
        self.assertNotIn(token, json.dumps(events))
        self.assertEqual(events[-1], {"event": "done", "ratePosts": 38})

    def test_one_timeout_is_collected_without_retry_or_cancelling_already_started_peers(self):
        state, events, _ = self.harness(fail_branch="53")
        rows = [e for e in events if e["event"] == "result"]
        self.assertEqual(len(state["requests"]), 39)
        self.assertEqual(len(rows), 38)
        self.assertEqual([e["reason"] for e in rows].count("timeout"), 1)
        self.assertEqual([e["reason"] for e in rows].count(None), 37)

    def test_blocked_token_never_launches_rate_requests(self):
        state, events, _ = self.harness(token_status=403)
        self.assertEqual(len(state["requests"]), 1)
        self.assertEqual(events[-1]["ratePosts"], 0)

    def test_near_expiry_token_is_not_used_or_refreshed(self):
        state, events, _ = self.harness(lifetime=20)
        self.assertEqual(len(state["requests"]), 1)
        self.assertEqual(next(e for e in events if e["event"] == "token_result")["reason"], "near_expiry_token")

    def test_parent_lease_check_can_stop_all_rates_after_token(self):
        state, events, _ = self.harness(authorize=False)
        self.assertEqual(len(state["requests"]), 1)
        self.assertEqual(events[-1]["ratePosts"], 0)


if __name__ == "__main__":
    unittest.main()
