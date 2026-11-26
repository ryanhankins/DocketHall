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
