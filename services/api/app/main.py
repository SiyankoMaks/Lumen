import json
import logging
import time
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from .auth import current_user, database, dummy_hash, issue, passwords, rate_limit, rotate
from .db import Conflict, Entity, Evidence, Job, Operation, RefreshSession, Revision, User, now
from .domain import fingerprint, mutate, owned, snapshot
from .schemas import (
    Credentials,
    EntityOut,
    EntryMutation,
    JobRequest,
    KnowledgeMutation,
    Mutation,
    Refresh,
    Tokens,
)

app = FastAPI(title="Lumen", version="0.1.0")
log = logging.getLogger("lumen")
prefix = "/api/v1"


@app.middleware("http")
async def telemetry(request: Request, call_next):
    request_id = str(uuid4())
    start = time.monotonic()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    # Never log request bodies, query text, bearer tokens or provider credentials.
    log.info(
        "request_id=%s method=%s status=%s duration_ms=%d",
        request_id,
        request.method,
        response.status_code,
        int((time.monotonic() - start) * 1000),
    )
    return response


@app.get("/health")
def health(db=Depends(database)):
    from sqlalchemy import text

    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@app.post(prefix + "/auth/register", response_model=Tokens, dependencies=[Depends(rate_limit)])
def register(body: Credentials, db=Depends(database)):
    user = User(email=str(body.email).lower(), password_hash=passwords.hash(body.password))
    db.add(user)
    try:
        db.flush()
        result = issue(db, user)
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Account cannot be registered") from None


@app.post(prefix + "/auth/login", response_model=Tokens, dependencies=[Depends(rate_limit)])
def login(body: Credentials, db=Depends(database)):
    user = db.scalar(select(User).where(User.email == str(body.email).lower()))
    valid = passwords.verify(body.password, user.password_hash if user else dummy_hash)
    if not user or not valid:
        raise HTTPException(401, "Invalid credentials")
    result = issue(db, user)
    db.commit()
    return result


@app.post(prefix + "/auth/refresh", response_model=Tokens, dependencies=[Depends(rate_limit)])
def refresh(body: Refresh, db=Depends(database)):
    return rotate(db, body.refresh_token)


@app.post(prefix + "/auth/logout")
def logout(user=Depends(current_user), db=Depends(database)):
    db.execute(delete(RefreshSession).where(RefreshSession.user_id == user.id))
    db.commit()
    return {"ok": True}


@app.get(prefix + "/account")
def account(user=Depends(current_user)):
    return {"id": user.id, "email": user.email, "settings": user.settings}


@app.get(prefix + "/account/export")
def export(user=Depends(current_user), db=Depends(database)):
    entities = db.scalars(select(Entity).where(Entity.user_id == user.id)).all()
    ids = [e.id for e in entities]
    return {
        "format_version": 1,
        "exported_at": now().isoformat(),
        "account": {"email": user.email, "settings": user.settings},
        "entities": [snapshot(e) for e in entities],
        "revisions": [
            r.snapshot for r in db.scalars(select(Revision).where(Revision.entity_id.in_(ids)))
        ],
        "conflicts": [
            {"id": c.id, "local": c.local_snapshot, "server": c.server_snapshot}
            for c in db.scalars(select(Conflict).where(Conflict.user_id == user.id))
        ],
    }


@app.delete(prefix + "/account", dependencies=[Depends(rate_limit)])
def delete_account(body: Credentials, user=Depends(current_user), db=Depends(database)):
    if str(body.email).lower() != user.email or not passwords.verify(
        body.password, user.password_hash
    ):
        raise HTTPException(401, "Invalid credentials")
    db.scalar(select(User).where(User.id == user.id).with_for_update())
    ids = select(Entity.id).where(Entity.user_id == user.id)
    for model, condition in [
        (Evidence, Evidence.entity_id.in_(ids)),
        (Revision, Revision.entity_id.in_(ids)),
        (Conflict, Conflict.user_id == user.id),
        (Operation, Operation.user_id == user.id),
        (Job, Job.user_id == user.id),
        (RefreshSession, RefreshSession.user_id == user.id),
        (Entity, Entity.user_id == user.id),
    ]:
        db.execute(delete(model).where(condition))
    db.delete(user)
    db.commit()
    return {"ok": True}


def resource(path, kind, dto):
    def listing(
        after: str = "",
        limit: int = Query(100, ge=1, le=500),
        include_deleted: bool = False,
        user=Depends(current_user),
        db=Depends(database),
    ):
        q = select(Entity).where(Entity.user_id == user.id, Entity.kind == kind, Entity.id > after)
        if not include_deleted:
            q = q.where(Entity.deleted_at.is_(None))
        return [snapshot(e) for e in db.scalars(q.order_by(Entity.id).limit(limit))]

    def detail(entity_id: UUID, user=Depends(current_user), db=Depends(database)):
        return snapshot(owned(db, user.id, entity_id, kind))

    def history(entity_id: UUID, user=Depends(current_user), db=Depends(database)):
        entity = owned(db, user.id, entity_id, kind)
        return [
            r.snapshot
            for r in db.scalars(
                select(Revision).where(Revision.entity_id == entity.id).order_by(Revision.revision)
            )
        ]

    def create(body, user=Depends(current_user), db=Depends(database)):
        result, code = mutate(db, user.id, kind, body, "create")
        return JSONResponse(result, status_code=code)

    def update(entity_id: UUID, body, user=Depends(current_user), db=Depends(database)):
        if entity_id != body.id:
            raise HTTPException(422, "Path id must equal body id")
        result, code = mutate(db, user.id, kind, body, "save")
        return JSONResponse(result, status_code=code)

    def remove(entity_id: UUID, body, user=Depends(current_user), db=Depends(database)):
        if entity_id != body.id or not body.deleted:
            raise HTTPException(422, "Delete requires matching id and deleted=true")
        result, code = mutate(db, user.id, kind, body, "delete")
        return JSONResponse(result, status_code=code)

    for func in [create, update, remove]:
        func.__annotations__["body"] = dto
    root = prefix + path
    for suffix, method, func, output in [
        ("", "GET", listing, list[EntityOut]),
        ("", "POST", create, EntityOut),
        ("/{entity_id}", "GET", detail, EntityOut),
        ("/{entity_id}", "PATCH", update, EntityOut),
        ("/{entity_id}", "DELETE", remove, EntityOut),
        ("/{entity_id}/revisions", "GET", history, list[EntityOut]),
    ]:
        app.add_api_route(
            root + suffix,
            func,
            methods=[method],
            response_model=output,
            name=kind + "_" + func.__name__,
            operation_id=kind + "_" + func.__name__,
        )


for path, kind in [
    ("/entries", "entry"),
    ("/structures", "structured_entry"),
    ("/patterns", "pattern"),
    ("/hypotheses", "hypothesis"),
    ("/experiments", "experiment"),
    ("/experiment-suggestions", "experiment_suggestion"),
    ("/reviews/weekly", "weekly_review"),
]:
    resource(path, kind, EntryMutation if kind == "entry" else KnowledgeMutation)


@app.get(prefix + "/conflicts")
def conflicts(user=Depends(current_user), db=Depends(database)):
    return [
        {
            "id": c.id,
            "entity_id": c.entity_id,
            "local_snapshot": c.local_snapshot,
            "server_snapshot": c.server_snapshot,
            "base_revision": c.base_revision,
        }
        for c in db.scalars(
            select(Conflict).where(Conflict.user_id == user.id, Conflict.resolved_at.is_(None))
        )
    ]


@app.post(prefix + "/conflicts/{conflict_id}/resolve", response_model=EntityOut)
def resolve(conflict_id: UUID, body: Mutation, user=Depends(current_user), db=Depends(database)):
    conflict = db.get(Conflict, str(conflict_id))
    if not conflict or conflict.user_id != user.id:
        raise HTTPException(404, "Conflict not found")
    entity = owned(db, user.id, conflict.entity_id)
    if (entity.kind == "entry") != isinstance(body, EntryMutation):
        raise HTTPException(422, "Content schema does not match resource")
    result, code = mutate(db, user.id, entity.kind, body, "resolve", str(conflict_id))
    return JSONResponse(result, status_code=code)


@app.post(prefix + "/ai/jobs", dependencies=[Depends(rate_limit)])
def enqueue(body: JobRequest, user=Depends(current_user), db=Depends(database)):
    from .workers import dispatch

    db.scalar(select(User).where(User.id == user.id).with_for_update())
    hashed = fingerprint(body.model_dump(mode="json"))
    prior = db.get(Operation, str(body.operation_id))
    if prior:
        if prior.user_id != user.id or prior.request_hash != hashed:
            raise HTTPException(409, "Operation reused")
        return prior.result
    source_bytes = 0
    if len({(r.id, r.revision) for r in body.sources}) != len(body.sources):
        raise HTTPException(422, "Duplicate sources")
    for ref in body.sources:
        entity = owned(db, user.id, ref.id)
        source_bytes += len(json.dumps(entity.content).encode())
        if entity.deleted_at or entity.revision != ref.revision:
            raise HTTPException(409, "Source changed; refresh before analysis")
        if body.kind == "weekly_review" and entity.kind == "entry":
            occurred = datetime.fromisoformat(entity.content["occurred_at"].replace("Z", "+00:00"))
            if not body.period_start <= occurred < body.period_end:
                raise HTTPException(422, "Entry outside review period")
        if body.kind == "experiment_suggestion" and entity.kind != "hypothesis":
            raise HTTPException(422, "Experiment suggestions need hypotheses")
    if source_bytes > 100000:
        raise HTTPException(413, "Select fewer sources for analysis")
    if body.kind == "structured_entry" and (len(body.sources) != 1 or entity.kind != "entry"):
        raise HTTPException(422, "Select one entry")
    job = Job(
        user_id=user.id,
        kind=body.kind,
        sources=body.model_dump(mode="json")["sources"],
        context={
            "period_start": body.period_start.isoformat() if body.period_start else None,
            "period_end": body.period_end.isoformat() if body.period_end else None,
        },
    )
    db.add(job)
    db.flush()
    result = {"id": job.id, "status": "queued"}
    db.add(
        Operation(
            operation_id=str(body.operation_id), user_id=user.id, request_hash=hashed, result=result
        )
    )
    db.commit()
    try:
        dispatch.delay()
    except Exception:
        # Transactional job table is the durable outbox; beat dispatches after Redis recovers.
        pass
    return result


@app.get(prefix + "/ai/jobs")
def jobs(user=Depends(current_user), db=Depends(database)):
    return [
        {
            "id": j.id,
            "kind": j.kind,
            "status": j.status,
            "result_ids": j.result_ids,
            "error": j.error,
        }
        for j in db.scalars(
            select(Job).where(Job.user_id == user.id).order_by(Job.created_at.desc()).limit(100)
        )
    ]


@app.post(prefix + "/ai/jobs/{job_id}/retry")
def retry_job(job_id: UUID, user=Depends(current_user), db=Depends(database)):
    job = db.scalar(
        select(Job).where(Job.id == str(job_id), Job.user_id == user.id).with_for_update()
    )
    if not job:
        raise HTTPException(404, "Not found")
    if job.status == "failed":
        job.status, job.error, job.updated_at = "queued", None, now()
        db.commit()
    return {"id": job.id, "status": job.status}


@app.post(prefix + "/ai/jobs/{job_id}/cancel")
def cancel_job(job_id: UUID, user=Depends(current_user), db=Depends(database)):
    job = db.scalar(
        select(Job).where(Job.id == str(job_id), Job.user_id == user.id).with_for_update()
    )
    if not job:
        raise HTTPException(404, "Not found")
    if job.status in {"queued", "running"}:
        job.status, job.updated_at = "cancelled", now()
        db.commit()
    return {"id": job.id, "status": job.status}
