"""
Quick smoke tests for ShopReply Backend API.
Run: python test_api.py (with backend running on localhost:3000)
"""
import httpx
import json
import sys
import time

BASE = "http://localhost:3939"
CLIENT = httpx.Client(timeout=30.0)

# Track created IDs for cleanup
_created_qa_ids: list[int] = []


def check_backend():
    """Verify backend is reachable before running tests."""
    try:
        r = CLIENT.get(f"{BASE}/health")
        if r.status_code != 200:
            print(f"Backend returned status {r.status_code}")
            sys.exit(1)
    except httpx.ConnectError:
        print(f"Cannot connect to backend at {BASE}")
        print("Start the backend first: python run.py")
        sys.exit(1)


def test_health():
    r = CLIENT.get(f"{BASE}/health")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    data = r.json()
    assert data["success"] is True
    assert data["data"]["status"] == "ok"
    assert data["data"]["version"] == "1.0.0"
    assert data["data"]["database"] == "connected"
    assert "qa_count" in data["data"]
    print(f"  Health check OK (ollama: {data['data']['ollama']}, qa: {data['data']['qa_count']})")


def test_qa_create():
    r = CLIENT.post(f"{BASE}/api/qa", json={
        "question": "Gia ao hoodie?",
        "answer": "350k nha ban",
    })
    assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
    data = r.json()
    assert data["success"] is True
    qa_id = data["data"]["id"]
    _created_qa_ids.append(qa_id)
    assert data["data"]["question"] == "Gia ao hoodie?"
    assert data["data"]["answer"] == "350k nha ban"
    assert data["data"]["is_active"] is True
    print(f"  Create Q&A #{qa_id}")
    return qa_id


def test_qa_list():
    r = CLIENT.get(f"{BASE}/api/qa")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert "items" in data["data"]
    assert "total" in data["data"]
    assert "page" in data["data"]
    assert "total_pages" in data["data"]
    print(f"  List Q&A: {data['data']['total']} pairs, page {data['data']['page']}/{data['data']['total_pages']}")


def test_qa_list_search():
    r = CLIENT.get(f"{BASE}/api/qa", params={"search": "hoodie"})
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    print(f"  Search Q&A 'hoodie': {data['data']['total']} results")


def test_qa_update(qa_id: int):
    r = CLIENT.put(f"{BASE}/api/qa/{qa_id}", json={
        "answer": "Ao hoodie gia 350k, size S-XL a"
    })
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    data = r.json()
    assert data["success"] is True
    assert data["data"]["answer"] == "Ao hoodie gia 350k, size S-XL a"
    print(f"  Update Q&A #{qa_id}")


def test_qa_delete(qa_id: int):
    r = CLIENT.delete(f"{BASE}/api/qa/{qa_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["data"]["deleted"] is True
    print(f"  Delete Q&A #{qa_id}")


def test_qa_not_found():
    r = CLIENT.put(f"{BASE}/api/qa/999999", json={"answer": "test"})
    assert r.status_code == 404
    r = CLIENT.delete(f"{BASE}/api/qa/999999")
    assert r.status_code == 404
    print("  Not-found returns 404")


def test_import():
    r = CLIENT.post(f"{BASE}/api/qa/import", json={
        "pairs": [
            {"question": "Doi tra the nao?", "answer": "Doi tra trong 7 ngay a"},
            {"question": "Size M vong nguc?", "answer": "Size M vong nguc 88-92cm"},
            {"question": "", "answer": "Invalid empty question"},
        ]
    })
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    result = data["data"]
    assert result["total_in_file"] == 3
    assert result["added"] >= 1
    assert result["skipped_invalid"] >= 1
    print(f"  Import: {result['added']} added, {result['skipped_duplicate']} dup, {result['skipped_invalid']} invalid")


def test_match_setup():
    """Create Q&A pairs for match testing."""
    pairs = [
        {"question": "Ship bao lau?", "answer": "Ship noi thanh 1-2 ngay a"},
        {"question": "Co COD khong?", "answer": "Co COD nha ban"},
        {"question": "Gia ao thun?", "answer": "Ao thun gia 200k a"},
    ]
    for p in pairs:
        r = CLIENT.post(f"{BASE}/api/qa", json=p)
        if r.status_code == 201:
            _created_qa_ids.append(r.json()["data"]["id"])
    print(f"  Created {len(pairs)} pairs for match test")


def test_match():
    r = CLIENT.post(f"{BASE}/api/match", json={
        "question": "Giao hang mat may ngay?",
        "platform": "facebook",
        "conversation_id": "test-conv-123",
        "sender_name": "Khach test",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    result = data["data"]
    assert result["match_type"] in ("auto", "suggest", "new")
    assert "message_id" in result
    assert isinstance(result["suggestions"], list)
    print(f"  Match: type={result['match_type']}, {len(result['suggestions'])} suggestions, ai={result.get('ai_suggestion') is not None}")
    return result["message_id"]


def test_send(message_id: int):
    r = CLIENT.post(f"{BASE}/api/send", json={
        "message_id": message_id,
        "reply_text": "Ship noi thanh 1-2 ngay a",
        "reply_type": "manual",
        "original_question": "Giao hang mat may ngay?",
        "platform": "facebook",
        "conversation_id": "test-conv-123",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    result = data["data"]
    assert result["reply_type"] == "manual"
    print(f"  Send: reply_type={result['reply_type']}, new_qa={result['new_qa_created']}")


def test_history_scan():
    r = CLIENT.post(f"{BASE}/api/history/scan", json={
        "messages": [
            {"sender": "customer", "name": "Khach A", "text": "Ao hoodie con size M khong?"},
            {"sender": "shop", "name": "Shop", "text": "Da con size M nha ban"},
            {"sender": "customer", "name": "Khach A", "text": "Ship bao lau vay?"},
            {"sender": "shop", "name": "Shop", "text": "Ship noi thanh 1-2 ngay a"},
            {"sender": "customer", "name": "Khach A", "text": "ok"},
        ],
        "platform": "facebook",
        "conversation_id": "scan-test-1",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    result = data["data"]
    assert isinstance(result["extracted_pairs"], list)
    assert result["total_messages_analyzed"] == 5
    print(f"  History scan: {len(result['extracted_pairs'])} pairs extracted, {result['skipped_messages']} skipped")


def test_llm_suggest():
    r = CLIENT.post(f"{BASE}/api/llm/suggest", json={
        "question": "Ao hoodie co mau gi?",
        "context": {
            "similar_qa": [
                {"question": "Gia hoodie?", "answer": "Ao hoodie gia 350k, size S-XL a"}
            ],
            "tone": "friendly",
        },
    })
    if r.status_code == 200:
        data = r.json()
        assert data["success"] is True
        result = data["data"]
        print(f"  LLM suggest: model={result['model']}, time={result.get('generation_time_ms', 'N/A')}ms")
    elif r.status_code == 503:
        print("  LLM suggest: SKIPPED (Ollama not running)")
    else:
        print(f"  LLM suggest: UNEXPECTED status {r.status_code}")


def test_settings_get():
    r = CLIENT.get(f"{BASE}/api/settings")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    s = data["data"]
    assert "auto_reply_threshold" in s
    assert "suggest_threshold" in s
    assert "tone" in s
    assert "enabled_platforms" in s
    assert isinstance(s["enabled_platforms"], list)
    print(f"  Get settings: threshold={s['auto_reply_threshold']}, tone={s['tone']}, platforms={s['enabled_platforms']}")


def test_settings_update():
    r = CLIENT.put(f"{BASE}/api/settings", json={
        "auto_reply_threshold": 0.90,
        "tone": "professional",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["data"]["auto_reply_threshold"] == 0.90
    assert data["data"]["tone"] == "professional"

    # Restore defaults
    CLIENT.put(f"{BASE}/api/settings", json={
        "auto_reply_threshold": 0.85,
        "tone": "friendly",
    })
    print("  Update settings: OK (restored defaults)")


def test_stats():
    r = CLIENT.get(f"{BASE}/api/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    s = data["data"]
    assert "period" in s
    assert "total_qa_pairs" in s
    assert "active_qa_pairs" in s
    assert "auto_replies_sent" in s
    assert "top_questions" in s
    assert "platform_breakdown" in s
    print(f"  Stats: {s['total_qa_pairs']} QA, {s['auto_replies_sent']} auto, {s['manual_replies_sent']} manual")

    # Test with period param
    r2 = CLIENT.get(f"{BASE}/api/stats", params={"period": "all"})
    assert r2.status_code == 200
    print(f"  Stats (all): {r2.json()['data']['total_messages_received']} messages total")


def test_log():
    r = CLIENT.get(f"{BASE}/api/log")
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    result = data["data"]
    assert "items" in result
    assert "total" in result
    assert "summary" in result
    summary = result["summary"]
    assert "total_auto_replies" in summary
    assert "reviewed" in summary
    assert "unreviewed" in summary
    print(f"  Log: {result['total']} entries, {summary['reviewed']} reviewed, {summary['unreviewed']} unreviewed")


def test_log_review():
    # We need a log entry to review -- create one via auto-match flow
    # First create a QA pair
    r = CLIENT.post(f"{BASE}/api/qa", json={
        "question": "Test review question?",
        "answer": "Test review answer",
    })
    if r.status_code != 201:
        print("  Log review: SKIPPED (could not create QA pair)")
        return
    qa_id = r.json()["data"]["id"]
    _created_qa_ids.append(qa_id)

    # Match to create a message
    r = CLIENT.post(f"{BASE}/api/match", json={
        "question": "Test review question?",
        "platform": "facebook",
        "conversation_id": "review-test-1",
    })
    msg_id = r.json()["data"]["message_id"]

    # Send as auto to create a log entry
    CLIENT.post(f"{BASE}/api/send", json={
        "message_id": msg_id,
        "reply_text": "Test review answer",
        "reply_type": "auto",
        "qa_id": qa_id,
        "original_question": "Test review question?",
        "platform": "facebook",
        "conversation_id": "review-test-1",
    })

    # Get the log entry
    r = CLIENT.get(f"{BASE}/api/log", params={"per_page": 1})
    items = r.json()["data"]["items"]
    if not items:
        print("  Log review: SKIPPED (no log entries found)")
        return

    log_id = items[0]["id"]

    # Review it
    r = CLIENT.post(f"{BASE}/api/log/{log_id}/review", json={
        "feedback": "ok",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["data"]["user_reviewed"] is True
    assert data["data"]["user_feedback"] == "ok"
    print(f"  Log review #{log_id}: feedback=ok")


def test_log_review_not_found():
    r = CLIENT.post(f"{BASE}/api/log/999999/review", json={"feedback": "ok"})
    assert r.status_code == 404
    print("  Log review not-found: returns 404")


def cleanup():
    """Clean up test data."""
    for qa_id in _created_qa_ids:
        try:
            CLIENT.delete(f"{BASE}/api/qa/{qa_id}")
        except Exception:
            pass


def main():
    print("=" * 50)
    print("  ShopReply Backend API Tests")
    print("=" * 50)

    check_backend()
    passed = 0
    failed = 0
    tests = [
        ("Health", test_health),
        ("Q&A Create", test_qa_create),
        ("Q&A List", test_qa_list),
        ("Q&A Search", test_qa_list_search),
        ("Q&A Update", lambda: test_qa_update(_created_qa_ids[-1]) if _created_qa_ids else None),
        ("Q&A Not Found", test_qa_not_found),
        ("Import", test_import),
        ("Match Setup", test_match_setup),
        ("Match", test_match),
        ("Send", lambda: test_send(test_match())),
        ("History Scan", test_history_scan),
        ("LLM Suggest", test_llm_suggest),
        ("Settings Get", test_settings_get),
        ("Settings Update", test_settings_update),
        ("Stats", test_stats),
        ("Log List", test_log),
        ("Log Review", test_log_review),
        ("Log Review 404", test_log_review_not_found),
        ("Q&A Delete", lambda: test_qa_delete(_created_qa_ids[0]) if _created_qa_ids else None),
    ]

    for name, fn in tests:
        try:
            fn()
            passed += 1
            print(f"  PASS: {name}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL: {name} -- {e}")
        except Exception as e:
            failed += 1
            print(f"  ERROR: {name} -- {type(e).__name__}: {e}")

    print()
    print("-" * 50)
    cleanup()

    if failed == 0:
        print(f"All {passed} tests passed!")
    else:
        print(f"{passed} passed, {failed} failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
