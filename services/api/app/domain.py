import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select, update

from .db import Conflict, Entity, Evidence, Operation, Revision, now
from .schemas import KnowledgeContent


def snapshot(e):
    return {
        "id": e.id,
        "kind": e.kind,
        "content": e.content,
        "revision": e.revision,
        "source": e.source,
        "created_at": e.created_at.isoformat(),
        "updated_at": e.updated_at.isoformat(),
        "deleted_at": e.deleted_at.isoformat() if e.deleted_at else None,
    }


def owned(db, user_id, entity_id, kind=None, lock=False):
    q = select(Entity).where(Entity.id == str(entity_id), Entity.user_id == user_id)
    if kind:
        q = q.where(Entity.kind == kind)
    if lock:
        q = q.with_for_update()
    e = db.scalar(q.execution_options(populate_existing=True))
    if not e:
        raise HTTPException(404, "Not found")
    return e


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def validate_knowledge(db, user_id, kind, content, entity_id):
    data = KnowledgeContent.model_validate(content)
    allowed = {
        "structured_entry": {"draft", "active", "rejected", "archived"},
        "pattern": {"draft", "active", "rejected", "archived"},
        "hypothesis": {"draft", "active", "supported", "weakened", "rejected", "archived"},
        "experiment": {"draft", "active", "completed", "cancelled", "archived"},
        "experiment_suggestion": {"draft", "active", "rejected", "archived"},
        "weekly_review": {"draft", "active", "archived"},
    }
    if data.status not in allowed[kind]:
        raise HTTPException(422, "Status does not apply to this resource")
    refs = {(str(r.id), r.revision) for r in data.evidence}
    if len(refs) != len(data.evidence):
        raise HTTPException(422, "Duplicate evidence")
    for ref in data.evidence:
        if str(ref.id) == entity_id:
            raise HTTPException(422, "Self evidence is not allowed")
        target = owned(db, user_id, ref.id)
        if target.deleted_at or not db.scalar(
            select(Revision.id).where(
                Revision.entity_id == target.id, Revision.revision == ref.revision
            )
        ):
            raise HTTPException(422, "Evidence revision is missing or deleted")
    if kind == "pattern":
        entries = {str(r.id) for r in data.evidence if owned(db, user_id, r.id).kind == "entry"}
        if len(entries) < 3:
            raise HTTPException(422, "A pattern requires at least three distinct entries")
    if kind == "experiment":
        if not data.hypothesis_id or not data.success_criteria.strip():
            raise HTTPException(422, "Experiment needs hypothesis and success criteria")
        hypothesis = owned(db, user_id, data.hypothesis_id, "hypothesis")
        if hypothesis.deleted_at or (
            data.status == "active" and hypothesis.content["status"] != "active"
        ):
            raise HTTPException(422, "An active experiment needs an active hypothesis")
        if data.start_at and data.end_at and data.start_at > data.end_at:
            raise HTTPException(422, "Invalid experiment dates")
        if data.status == "completed" and not data.result.strip():
            raise HTTPException(422, "Completed experiment needs a result")
    return data.model_dump(mode="json")


def record_revision(db, entity):
    db.flush()
    value = snapshot(entity)
    db.add(
        Revision(
            entity_id=entity.id, revision=entity.revision, snapshot=value, source=entity.source
        )
    )
    for ref in entity.content.get("evidence", []):
        db.add(
            Evidence(
                entity_id=entity.id,
                entity_revision=entity.revision,
                target_id=ref["id"],
                target_revision=ref["revision"],
            )
        )
    return value


def mutate(db, user_id, kind, request, action="save", conflict_id=None):
    # Locking the owner serializes cross-resource invariants, operation deduplication,
    # account deletion and evidence validation within this user's transactions.
    from .db import User

    db.scalar(select(User).where(User.id == user_id).with_for_update())
    payload = request.model_dump(mode="json")
    hashed = fingerprint(
        {"kind": kind, "action": action, "request": payload, "conflict_id": conflict_id}
    )
    prior = db.get(Operation, str(request.operation_id))
    if prior:
        if prior.user_id != user_id or prior.request_hash != hashed:
            raise HTTPException(409, "operation_id reused with different request")
        return prior.result, prior.status_code
    entity_id = str(request.id)
    entity = db.get(Entity, entity_id, populate_existing=True)
    if entity and (entity.user_id != user_id or entity.kind != kind):
        raise HTTPException(404, "Not found")
    if action != "create" and not entity:
        raise HTTPException(404, "Not found")
    if action == "create" and request.base_revision != 0:
        raise HTTPException(422, "Create requires base_revision=0")
    if entity and (entity.revision != request.base_revision or action == "create"):
        conflict = Conflict(
            user_id=user_id,
            entity_id=entity_id,
            local_snapshot=payload,
            server_snapshot=snapshot(entity),
            base_revision=request.base_revision,
        )
        db.add(conflict)
        db.flush()
        result = {
            "conflict_id": conflict.id,
            "server_snapshot": snapshot(entity),
            "local_snapshot": payload,
        }
        code = 409
    else:
        content = payload["content"]
        if kind != "entry":
            content = validate_knowledge(db, user_id, kind, content, entity_id)
            if entity and "ai" in entity.content:
                content["ai"] = entity.content["ai"]
        if entity is None:
            entity = Entity(
                id=entity_id,
                user_id=user_id,
                kind=kind,
                content=content,
                revision=1,
                source="user",
                created_at=now(),
                updated_at=now(),
            )
            db.add(entity)
        else:
            entity.revision += 1
            entity.content = content
            entity.source = "user"
            entity.updated_at = now()
        entity.deleted_at = now() if request.deleted else None
        result, code = record_revision(db, entity), 200
        if conflict_id:
            conflict = db.get(Conflict, conflict_id)
            if not conflict or conflict.user_id != user_id or conflict.entity_id != entity_id:
                raise HTTPException(404, "Conflict not found")
            conflict.resolved_at = now()
            db.execute(
                update(Conflict)
                .where(
                    Conflict.user_id == user_id,
                    Conflict.entity_id == entity_id,
                    Conflict.resolved_at.is_(None),
                )
                .values(resolved_at=now())
            )
    db.add(
        Operation(
            operation_id=str(request.operation_id),
            user_id=user_id,
            request_hash=hashed,
            result=result,
            status_code=code,
        )
    )
    db.commit()
    return result, code
