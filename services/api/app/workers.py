import asyncio
from datetime import timedelta, timezone

from celery import Celery
from sqlalchemy import select

from .ai import PROMPT_VERSION, generate
from .config import settings
from .db import Entity, Job, Session, User, now, uid
from .domain import owned, record_revision, snapshot, validate_knowledge

celery = Celery("lumen", broker=settings.redis_url)
celery.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={"dispatch": {"task": "lumen.dispatch", "schedule": 15.0}},
)


@celery.task(name="lumen.dispatch")
def dispatch():
    with Session() as db:
        # Leases recover jobs after an abruptly terminated worker.
        for j in db.scalars(
            select(Job)
            .where(Job.status == "running", Job.updated_at < now() - timedelta(minutes=10))
            .with_for_update(skip_locked=True)
        ):
            j.status = "queued"
        ids = list(db.scalars(select(Job.id).where(Job.status == "queued").limit(100)))
        db.commit()
    for job_id in ids:
        process.delay(job_id)


@celery.task(name="lumen.process")
def process(job_id):
    with Session() as db:
        job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
        if not job or job.status != "queued":
            return
        job.status, job.updated_at = "running", now()
        lease = job.updated_at
        user_id, kind = job.user_id, job.kind
        claimed = False
        try:
            sources = []
            for ref in job.sources:
                e = owned(db, user_id, ref["id"])
                if e.deleted_at or e.revision != ref["revision"]:
                    raise ValueError("stale_source")
                sources.append(snapshot(e))
            db.commit()
            claimed = True
            result, provider, model = asyncio.run(generate(kind, sources))
            db.expire_all()
            db.scalar(select(User).where(User.id == user_id).with_for_update())
            job = db.scalar(
                select(Job)
                .where(Job.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if (
                not job
                or job.status != "running"
                or (
                    job.updated_at
                    if job.updated_at.tzinfo
                    else job.updated_at.replace(tzinfo=timezone.utc)
                )
                != lease
            ):
                return
            for ref in job.sources:
                e = owned(db, user_id, ref["id"])
                if e.deleted_at or e.revision != ref["revision"]:
                    raise ValueError("stale_source")
            ids = []
            for item in result.items:
                entity_id = uid()
                content = validate_knowledge(
                    db, user_id, kind, item.model_dump(mode="json"), entity_id
                )
                content["ai"] = {
                    "provider": provider,
                    "model": model,
                    "prompt_version": PROMPT_VERSION,
                    "prompt_name": kind,
                    "source_revisions": job.sources,
                    **job.context,
                }
                e = Entity(
                    id=entity_id,
                    user_id=user_id,
                    kind=kind,
                    content=content,
                    revision=1,
                    source="ai",
                    created_at=now(),
                    updated_at=now(),
                )
                db.add(e)
                record_revision(db, e)
                ids.append(entity_id)
            job.status, job.result_ids, job.updated_at = "completed", ids, now()
            db.commit()
        except Exception as exc:
            db.rollback()
            job = db.scalar(
                select(Job)
                .where(Job.id == job_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if job and (
                not claimed
                or (
                    job.status == "running"
                    and (
                        job.updated_at
                        if job.updated_at.tzinfo
                        else job.updated_at.replace(tzinfo=timezone.utc)
                    )
                    == lease
                )
            ):
                job.status, job.error, job.updated_at = "failed", type(exc).__name__, now()
                db.commit()
