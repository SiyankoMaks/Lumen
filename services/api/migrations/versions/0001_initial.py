"""Initial revision envelope, evidence, auth and durable jobs.

Revision ID: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    j = sa.JSON().with_variant(JSONB(), "postgresql")
    dt = sa.DateTime(timezone=True)
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("settings", j, nullable=False),
        sa.Column("created_at", dt, nullable=False),
    )

    def owner():
        return sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )

    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        owner(),
        sa.Column("family", sa.String(36), nullable=False),
        sa.Column("expires_at", dt, nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "entities",
        sa.Column("id", sa.String(36), primary_key=True),
        owner(),
        sa.Column("kind", sa.String(32), nullable=False, index=True),
        sa.Column("content", j, nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("created_at", dt, nullable=False),
        sa.Column("updated_at", dt, nullable=False, index=True),
        sa.Column("deleted_at", dt),
    )

    def entity(name):
        return sa.Column(
            name, sa.String(36), sa.ForeignKey("entities.id", ondelete="CASCADE"), nullable=False
        )

    op.create_table(
        "revisions",
        sa.Column("id", sa.String(36), primary_key=True),
        entity("entity_id"),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("snapshot", j, nullable=False),
        sa.Column("source", sa.String(12), nullable=False),
        sa.Column("created_at", dt, nullable=False),
        sa.UniqueConstraint("entity_id", "revision"),
    )
    op.create_index("ix_revisions_entity_id", "revisions", ["entity_id"])
    op.create_table(
        "evidence",
        sa.Column("id", sa.String(36), primary_key=True),
        entity("entity_id"),
        sa.Column("entity_revision", sa.Integer(), nullable=False),
        entity("target_id"),
        sa.Column("target_revision", sa.Integer(), nullable=False),
        sa.UniqueConstraint("entity_id", "entity_revision", "target_id", "target_revision"),
    )
    op.create_index("ix_evidence_entity_id", "evidence", ["entity_id"])
    op.create_table(
        "operations",
        sa.Column("operation_id", sa.String(36), primary_key=True),
        owner(),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("result", j, nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("created_at", dt, nullable=False),
    )
    op.create_table(
        "conflicts",
        sa.Column("id", sa.String(36), primary_key=True),
        owner(),
        entity("entity_id"),
        sa.Column("local_snapshot", j, nullable=False),
        sa.Column("server_snapshot", j, nullable=False),
        sa.Column("base_revision", sa.Integer(), nullable=False),
        sa.Column("resolved_at", dt),
        sa.Column("created_at", dt, nullable=False),
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        owner(),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("sources", j, nullable=False),
        sa.Column("context", j, nullable=False),
        sa.Column("result_ids", j, nullable=False),
        sa.Column("error", sa.String(80)),
        sa.Column("created_at", dt, nullable=False),
        sa.Column("updated_at", dt, nullable=False),
    )


def downgrade():
    for name in [
        "jobs",
        "conflicts",
        "operations",
        "evidence",
        "revisions",
        "entities",
        "refresh_sessions",
        "users",
    ]:
        op.drop_table(name)
