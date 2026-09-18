import hashlib
import secrets
from datetime import UTC, timedelta

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import delete, select

from .config import settings
from .db import RefreshSession, Session, User, now, uid

passwords = PasswordHash.recommended()
bearer = HTTPBearer()
dummy_hash = passwords.hash("constant-time-dummy-password")


def database():
    with Session() as db:
        yield db


def current_user(token: HTTPAuthorizationCredentials = Depends(bearer), db=Depends(database)):
    try:
        data = jwt.decode(
            token.credentials,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience="lumen",
            options={"require": ["exp", "sub", "aud"]},
        )
        user = db.get(User, data["sub"])
        if not user:
            raise ValueError()
        return user
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, "Session expired") from None


def issue(db, user, family=None):
    if len(settings.jwt_secret) < 32:
        raise HTTPException(503, "Configure JWT_SECRET with at least 32 characters")
    raw = secrets.token_urlsafe(48)
    db.add(
        RefreshSession(
            id=hashlib.sha256(raw.encode()).hexdigest(),
            user_id=user.id,
            family=family or uid(),
            expires_at=now() + timedelta(days=30),
        )
    )
    access = jwt.encode(
        {"sub": user.id, "aud": "lumen", "exp": now() + timedelta(minutes=15)},
        settings.jwt_secret,
        algorithm="HS256",
    )
    return {"access_token": access, "refresh_token": raw, "user_id": user.id}


def rotate(db, raw):
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    row = db.scalar(select(RefreshSession).where(RefreshSession.id == token_hash).with_for_update())
    if not row or row.expires_at.replace(tzinfo=UTC) < now():
        raise HTTPException(401, "Refresh expired")
    if row.used:
        db.execute(delete(RefreshSession).where(RefreshSession.family == row.family))
        db.commit()
        raise HTTPException(401, "Refresh reuse detected; sign in again")
    row.used = True
    result = issue(db, db.get(User, row.user_id), row.family)
    db.commit()
    return result


def rate_limit(request: Request):
    # Redis is shared by all API processes. Fail closed on sensitive endpoints.
    from redis import Redis
    from redis.exceptions import RedisError

    key = hashlib.sha256(
        (request.client.host if request.client else "unknown").encode()
    ).hexdigest()
    try:
        client = Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        count = client.eval(
            "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
            1,
            "auth:" + key,
        )
        if count > 20:
            raise HTTPException(429, "Try again later", headers={"Retry-After": "60"})
    except RedisError:
        raise HTTPException(503, "Authentication temporarily unavailable") from None
