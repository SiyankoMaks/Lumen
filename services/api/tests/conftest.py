import os

import pytest
from app.auth import database, rate_limit
from app.config import settings
from app.db import Base
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def client():
    url = os.getenv("TEST_DATABASE_URL", "sqlite://")
    engine = create_engine(
        url,
        **(
            {"connect_args": {"check_same_thread": False}, "poolclass": StaticPool}
            if url == "sqlite://"
            else {}
        ),
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)

    def db():
        with factory() as session:
            yield session

    settings.jwt_secret = "test-only-secret-that-is-longer-than-32-chars"
    app.dependency_overrides[database] = db
    app.dependency_overrides[rate_limit] = lambda: None
    with TestClient(app) as client:
        client.factory = factory
        yield client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def auth(client):
    response = client.post(
        "/api/v1/auth/register", json={"email": "one@example.com", "password": "a-long-password"}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}
