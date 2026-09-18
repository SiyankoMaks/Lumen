from uuid import uuid4

from app import workers
from app.db import Entity, Evidence, Job
from app.schemas import AIResult
from sqlalchemy import select


def make_job(client, auth, monkeypatch):
    monkeypatch.setattr(workers.dispatch, "delay", lambda: None)
    body = {
        "id": str(uuid4()),
        "operation_id": str(uuid4()),
        "base_revision": 0,
        "content": {
            "text": "После прогулки стало легче сосредоточиться.",
            "occurred_at": "2026-09-16T10:00:00Z",
        },
    }
    source = client.post("/api/v1/entries", headers=auth, json=body).json()
    job = client.post(
        "/api/v1/ai/jobs",
        headers=auth,
        json={
            "operation_id": str(uuid4()),
            "kind": "structured_entry",
            "sources": [{"id": source["id"], "revision": 1}],
        },
    ).json()
    monkeypatch.setattr(workers, "Session", client.factory)
    return source, job


def test_worker_citations_history_manual_correction(client, auth, monkeypatch):
    source, job = make_job(client, auth, monkeypatch)

    async def fake(kind, sources):
        return (
            AIResult.model_validate(
                {
                    "items": [
                        {
                            "title": "Наблюдение",
                            "description": "Прогулка и внимание",
                            "evidence": [{"id": source["id"], "revision": 1}],
                        }
                    ]
                }
            ),
            "fake",
            "test",
        )

    monkeypatch.setattr(workers, "generate", fake)
    workers.process(job["id"])
    workers.process(job["id"])
    with client.factory() as db:
        row = db.get(Job, job["id"])
        assert row.status == "completed"
        artifact = db.get(Entity, row.result_ids[0])
        artifact_id = artifact.id
        assert artifact.content["ai"]["prompt_version"] == "1.0.0"
        assert len(list(db.scalars(select(Evidence).where(Evidence.entity_id == artifact.id)))) == 1
    artifact = client.get("/api/v1/structures/" + artifact_id, headers=auth).json()
    editable = {k: v for k, v in artifact["content"].items() if k != "ai"}
    editable["description"] = "Моя правка"
    editable["status"] = "active"
    result = client.patch(
        "/api/v1/structures/" + artifact_id,
        headers=auth,
        json={
            "id": artifact_id,
            "operation_id": str(uuid4()),
            "base_revision": 1,
            "content": editable,
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["content"]["ai"]["provider"] == "fake"
    history = client.get("/api/v1/structures/" + artifact_id + "/revisions", headers=auth).json()
    assert [r["source"] for r in history] == ["ai", "user"]


def test_worker_rejects_source_changed_during_generation(client, auth, monkeypatch):
    source, job = make_job(client, auth, monkeypatch)

    async def fake(kind, sources):
        with client.factory() as db:
            entry = db.get(Entity, source["id"])
            entry.revision = 2
            db.commit()
        return AIResult(items=[]), "fake", "test"

    monkeypatch.setattr(workers, "generate", fake)
    workers.process(job["id"])
    with client.factory() as db:
        assert db.get(Job, job["id"]).status == "failed"
        assert not list(db.scalars(select(Entity).where(Entity.kind == "structured_entry")))


def test_weekly_scope_validation(client, auth, monkeypatch):
    source, _ = make_job(client, auth, monkeypatch)
    body = {
        "operation_id": str(uuid4()),
        "kind": "weekly_review",
        "sources": [{"id": source["id"], "revision": 1}],
    }
    assert client.post("/api/v1/ai/jobs", headers=auth, json=body).status_code == 422
    body.update(period_start="2026-09-01T00:00:00Z", period_end="2026-09-08T00:00:00Z")
    assert client.post("/api/v1/ai/jobs", headers=auth, json=body).status_code == 422
    body.update(period_start="2026-09-14T00:00:00Z", period_end="2026-09-21T00:00:00Z")
    response = client.post("/api/v1/ai/jobs", headers=auth, json=body)
    assert response.status_code == 200, response.text
    assert client.post("/api/v1/ai/jobs", headers=auth, json=body).json() == response.json()


def test_cancelled_job_cannot_publish_result(client, auth, monkeypatch):
    source, job = make_job(client, auth, monkeypatch)

    async def fake(kind, sources):
        response = client.post("/api/v1/ai/jobs/" + job["id"] + "/cancel", headers=auth)
        assert response.json()["status"] == "cancelled"
        return AIResult(items=[]), "fake", "test"

    monkeypatch.setattr(workers, "generate", fake)
    workers.process(job["id"])
    with client.factory() as db:
        assert db.get(Job, job["id"]).status == "cancelled"
