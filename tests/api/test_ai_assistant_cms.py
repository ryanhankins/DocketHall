"""API tests for AI assistant CMS list/update/publish deduplication."""


def test_ai_blog_notice_page_publish_without_duplication(admin_client):
    from app import ai_assistant
    from app.db import pool

    admin_client.put("/api/modules/admin/communications", json={"enabled": True})
    user = admin_client.get("/api/me").json()
    title = "Friendly Reminder: Please Keep Dogs Away from Local Feral Cat Herds"

    # 1. Blog post: create draft -> publish via update_blog_post -> no duplicate
    res_draft, _ = ai_assistant._execute_tool(
        "create_blog_post",
        {"title": title, "summary": "Keep dogs leashed.", "body": "Please keep dogs away.", "is_published": False},
        user,
    )
    assert res_draft["ok"] is True, res_draft
    assert res_draft["is_published"] is False
    post_id = res_draft["post_id"]

    listed, _ = ai_assistant._execute_tool("list_blog_posts", {"search": "Feral Cat"}, user)
    assert listed["ok"] is True
    assert any(p["id"] == post_id and p["is_published"] is False for p in listed["posts"])

    res_pub, _ = ai_assistant._execute_tool(
        "update_blog_post",
        {"post_id": post_id, "is_published": True},
        user,
    )
    assert res_pub["ok"] is True
    assert res_pub["post_id"] == post_id
    assert res_pub["is_published"] is True

    # Calling create_blog_post again with the same title must NOT create a duplicate
    res_dup, _ = ai_assistant._execute_tool(
        "create_blog_post",
        {"title": title, "body": "Duplicate attempt", "is_published": True},
        user,
    )
    assert res_dup["ok"] is False

    # 2. Blog post draft -> calling create_blog_post(is_published=True) publishes in place
    draft2_title = "Spring Street Sweeping Schedule"
    d2, _ = ai_assistant._execute_tool(
        "create_blog_post",
        {"title": draft2_title, "body": "Sweeping starts Monday.", "is_published": False},
        user,
    )
    assert d2["ok"] is True
    p2, _ = ai_assistant._execute_tool(
        "create_blog_post",
        {"title": draft2_title, "body": "Sweeping starts Monday.", "is_published": True},
        user,
    )
    assert p2["ok"] is True
    assert p2["post_id"] == d2["post_id"]
    assert p2["is_published"] is True

    with pool.connection() as conn:
        cnt = conn.execute("SELECT COUNT(*) FROM blog_posts WHERE title = %s", (title,)).fetchone()[0]
        assert cnt == 1

    # 3. Notice: create draft -> update_notice publishes same row
    n_draft, _ = ai_assistant._execute_tool(
        "create_notice",
        {"title": "Water Main Flushing", "category": "Notice", "body": "Next Tuesday.", "is_public": False},
        user,
    )
    assert n_draft["ok"] is True
    assert n_draft["is_published"] is False
    n_list, _ = ai_assistant._execute_tool("list_notices", {"status": "draft"}, user)
    assert any(n["id"] == n_draft["notice_id"] for n in n_list["notices"])
    n_pub, _ = ai_assistant._execute_tool(
        "update_notice",
        {"title_match": "Water Main Flushing", "is_public": True},
        user,
    )
    assert n_pub["ok"] is True
    assert n_pub["notice_id"] == n_draft["notice_id"]
    assert n_pub["is_published"] is True

    # 4. Page: create draft -> update_page publishes same row
    pg_draft, _ = ai_assistant._execute_tool(
        "create_page",
        {"title": "Animal Control Policy", "body": "Leash rules.", "is_public": False},
        user,
    )
    assert pg_draft["ok"] is True
    pg_list, _ = ai_assistant._execute_tool("list_pages", {"search": "Animal Control"}, user)
    assert any(p["id"] == pg_draft["page_id"] for p in pg_list["pages"])
    pg_pub, _ = ai_assistant._execute_tool(
        "update_page",
        {"title_match": "Animal Control Policy", "is_public": True},
        user,
    )
    assert pg_pub["ok"] is True
    assert pg_pub["page_id"] == pg_draft["page_id"]
    assert pg_pub["is_public"] is True

    assert ai_assistant._describe_proposed_action("create_blog_post", {"title": "Test", "is_published": False}).startswith("Create draft")
    assert ai_assistant._describe_proposed_action("update_blog_post", {"title": "Test", "is_published": True}).startswith("Publish")


def test_ai_configurable_daily_spend_cap(admin_client, monkeypatch):
    from fastapi import HTTPException
    from app import ai_assistant

    admin_client.put("/api/modules/admin/ai_assistant", json={"enabled": True})

    st = admin_client.get("/api/ai/status")
    assert st.status_code == 200
    assert st.json()["daily_spend_limit_usd"] == 1.0

    # Mock Gemini verification call so PUT /api/ai/config works offline
    monkeypatch.setattr(ai_assistant, "_call_gemini", lambda key, model, payload, **kw: {"candidates": []})
    cfg = admin_client.put(
        "/api/ai/config",
        json={"api_key": "test-gemini-key-12345", "model": "gemini-3.8-flash", "daily_spend_limit_usd": 0.25},
    )
    assert cfg.status_code == 200, cfg.text
    assert cfg.json()["daily_spend_limit_usd"] == 0.25

    # Record usage below cap (100k input @ $0.30/1M = $0.03) -> allowed
    ai_assistant._record_gemini_usage("gemini-3.8-flash", {"usageMetadata": {"promptTokenCount": 100_000, "candidatesTokenCount": 0}})
    ai_assistant._enforce_daily_budget()

    # Record usage pushing over $0.25 (100k output @ $2.50/1M = $0.25) -> 429
    ai_assistant._record_gemini_usage("gemini-3.8-flash", {"usageMetadata": {"promptTokenCount": 0, "candidatesTokenCount": 100_000}})
    try:
        ai_assistant._enforce_daily_budget()
        assert False, "Expected HTTP 429 when daily spend cap reached"
    except HTTPException as exc:
        assert exc.status_code == 429

    # Raising cap or setting 0 (unlimited) unblocks immediately
    cfg2 = admin_client.put("/api/ai/config", json={"model": "gemini-3.8-flash", "daily_spend_limit_usd": 0})
    assert cfg2.status_code == 200
    ai_assistant._enforce_daily_budget()


def test_ai_allowed_in_demo_mode_while_config_blocked(admin_client, monkeypatch):
    from app import ai_assistant

    admin_client.put("/api/modules/admin/ai_assistant", json={"enabled": True})
    monkeypatch.setenv("DEMO_MODE", "true")

    # Config changes remain blocked in demo mode, and model/cap are forced to 3.5-flash-lite + $1/day
    st_demo = admin_client.get("/api/ai/status")
    assert st_demo.status_code == 200
    assert st_demo.json()["model"] == "gemini-3.5-flash-lite"
    assert st_demo.json()["daily_spend_limit_usd"] == 1.0
    assert st_demo.json()["available_models"] == ["gemini-3.5-flash-lite"]
    assert st_demo.json()["can_configure"] is False

    r_put = admin_client.put("/api/ai/config", json={"model": "gemini-3.8-flash", "daily_spend_limit_usd": 100})
    assert r_put.status_code == 403
    r_del = admin_client.delete("/api/ai/config")
    assert r_del.status_code == 403

    # /api/ai/command is allowed in demo mode and still enforces daily budget
    monkeypatch.setattr(
        ai_assistant,
        "_call_gemini",
        lambda key, model, payload, **kw: (
            ai_assistant._enforce_daily_budget() if kw.get("enforce_budget", True) else None,
            {"candidates": [{"content": {"parts": [{"text": "Ready in demo."}]}}]},
        )[1],
    )
    monkeypatch.setattr(ai_assistant, "_load_gemini_config", lambda: ("test-key-12345", "gemini-3.5-flash-lite", "integrations"))
    r_cmd = admin_client.post("/api/ai/command", json={"prompt": "Summarize today's agenda", "history": []})
    assert r_cmd.status_code == 200, r_cmd.text
    assert r_cmd.json()["reply"] == "Ready in demo."


def test_ai_add_agenda_item_attachment(admin_client):
    from app import ai_assistant

    admin_client.put("/api/modules/admin/agendas", json={"enabled": True})
    user = admin_client.get("/api/me").json()

    ag_res, _ = ai_assistant._execute_tool(
        "create_agenda",
        {"title": "Parks Committee", "body": "Parks Committee", "meeting_date": "2026-12-03", "meeting_time": "6:00 PM"},
        user,
    )
    assert ag_res["ok"] is True, ag_res
    ag_id = ag_res["agenda_id"]

    it_res, _ = ai_assistant._execute_tool(
        "add_agenda_item",
        {"agenda_id": ag_id, "title": "Proposal for Town Llama Rodeo Recreational Event", "description": "Rodeo details"},
        user,
    )
    assert it_res["ok"] is True, it_res

    att_res, _ = ai_assistant._execute_tool(
        "add_agenda_item_attachment",
        {
            "agenda_id": ag_id,
            "title": "City Code Summary: Llamas",
            "content": "No specific llama restrictions were found in the municipal code.",
        },
        user,
    )
    assert att_res["ok"] is True, att_res
    assert att_res["item_id"] == it_res["item_id"]

    ag_detail = admin_client.get(f"/api/agendas/{ag_id}")
    assert ag_detail.status_code == 200
    items = ag_detail.json()["items"]
    assert any(
        d["title"] == "City Code Summary: Llamas"
        for it in items
        for d in it.get("documents", [])
    )
