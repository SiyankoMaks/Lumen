from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from app.db import Entity, Revision
from sqlalchemy import select


def entry(text="Первая запись", revision=0, entity_id=None, deleted=False):
    return {
        "id": entity_id or str(uuid4()),
        "operation_id": str(uuid4()),
        "base_revision": revision,
        "content": {"text": text, "occurred_at": "2026-09-16T10:00:00Z"},
        "deleted": deleted,
    }


def test_vertical_slice_idempotency_conflict_resolution_tombstone(client, auth):
    body = entry()
    first = client.post("/api/v1/entries", json=body, headers=auth)
    assert first.status_code == 200, first.text
    assert client.post("/api/v1/entries", json=body, headers=auth).json() == first.json()
    path = "/api/v1/entries/" + body["id"]
    cloud = entry("Облачная версия", 1, body["id"])
    assert client.patch(path, json=cloud, headers=auth).json()["revision"] == 2
    local = entry("Локальная версия", 1, body["id"])
    conflict = client.patch(path, json=local, headers=auth)
    assert conflict.status_code == 409
    assert client.patch(path, json=local, headers=auth).json() == conflict.json()
    assert conflict.json()["server_snapshot"]["content"]["text"] == "Облачная версия"
    resolve = entry("Объединённая версия", 2, body["id"])
    result = client.post(
        "/api/v1/conflicts/" + conflict.json()["conflict_id"] + "/resolve",
        json=resolve,
        headers=auth,
    )
    assert result.status_code == 200, result.text
    assert result.json()["revision"] == 3
    assert client.get("/api/v1/conflicts", headers=auth).json() == []
    remove = entry("Объединённая версия", 3, body["id"], True)
    assert client.delete(path, headers=auth).status_code == 422
    assert client.request("DELETE", path, json=remove, headers=auth).json()["deleted_at"]
    assert client.get("/api/v1/entries", headers=auth).json() == []
    assert len(client.get("/api/v1/entries?include_deleted=true", headers=auth).json()) == 1
    assert len(client.get(path + "/revisions", headers=auth).json()) == 4


def test_permissions_and_operation_reuse(client, auth):
    body = entry()
    client.post("/api/v1/entries", json=body, headers=auth)
    other = client.post(
        "/api/v1/auth/register", json={"email": "two@example.com", "password": "other-password"}
    ).json()
    headers = {"Authorization": "Bearer " + other["access_token"]}
    assert client.get("/api/v1/entries/" + body["id"], headers=headers).status_code == 404
    assert client.get("/api/v1/entries", headers=headers).json() == []
    body["content"]["text"] = "different"
    assert client.post("/api/v1/entries", json=body, headers=auth).status_code == 409


def test_refresh_rotation_reuse_revokes_family(client, auth):
    tokens = client.post(
        "/api/v1/auth/login", json={"email": "one@example.com", "password": "a-long-password"}
    ).json()
    newer = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert newer.status_code == 200
    assert (
        client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/auth/refresh", json={"refresh_token": newer.json()["refresh_token"]}
        ).status_code
        == 401
    )


def test_evidence_and_experiment_lifecycle(client, auth):
    refs = []
    for i in range(3):
        body = entry(str(i))
        client.post("/api/v1/entries", json=body, headers=auth)
        refs.append({"id": body["id"], "revision": 1})

    def knowledge(content):
        return {
            "id": str(uuid4()),
            "operation_id": str(uuid4()),
            "base_revision": 0,
            "content": content,
        }

    pattern = knowledge({"title": "Повторение", "evidence": refs[:1]})
    assert client.post("/api/v1/patterns", json=pattern, headers=auth).status_code == 422
    pattern["content"]["evidence"] = refs
    assert client.post("/api/v1/patterns", json=pattern, headers=auth).status_code == 200
    hypothesis = knowledge(
        {
            "title": "Предположение",
            "status": "active",
            "evidence": [{"id": pattern["id"], "revision": 1}],
        }
    )
    assert client.post("/api/v1/hypotheses", json=hypothesis, headers=auth).status_code == 200
    experiment = knowledge(
        {
            "title": "Проверка",
            "status": "active",
            "hypothesis_id": hypothesis["id"],
            "success_criteria": "Три наблюдения",
            "evidence": [{"id": hypothesis["id"], "revision": 1}],
        }
    )
    assert client.post("/api/v1/experiments", json=experiment, headers=auth).status_code == 200
    experiment.update(operation_id=str(uuid4()), base_revision=1)
    experiment["content"]["status"] = "completed"
    path = "/api/v1/experiments/" + experiment["id"]
    assert client.patch(path, json=experiment, headers=auth).status_code == 422
    experiment["content"]["result"] = "Два из трёх"
    assert client.patch(path, json=experiment, headers=auth).json()["revision"] == 2


def test_account_deletion_and_export(client, auth):
    body = entry()
    client.post("/api/v1/entries", json=body, headers=auth)
    exported = client.get("/api/v1/account/export", headers=auth).json()
    assert len(exported["entities"]) == 1 and len(exported["revisions"]) == 1
    assert "password_hash" not in str(exported)
    assert (
        client.request(
            "DELETE",
            "/api/v1/account",
            headers=auth,
            json={"email": "one@example.com", "password": "a-long-password"},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/entries", headers=auth).status_code == 401


def test_concurrent_writes_postgres(client, auth):
    import pytest

    with client.factory() as db:
        if db.bind.dialect.name != "postgresql":
            pytest.skip("Requires PostgreSQL")
    body = entry()
    client.post("/api/v1/entries", json=body, headers=auth)
    path = "/api/v1/entries/" + body["id"]
    with ThreadPoolExecutor(2) as pool:
        results = list(
            pool.map(
                lambda text: client.patch(path, json=entry(text, 1, body["id"]), headers=auth),
                ["A", "B"],
            )
        )
    assert sorted(r.status_code for r in results) == [200, 409]
    with client.factory() as db:
        assert db.get(Entity, body["id"]).revision == 2
        assert len(list(db.scalars(select(Revision).where(Revision.entity_id == body["id"])))) == 2
