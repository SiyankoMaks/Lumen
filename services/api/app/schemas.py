from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Credentials(DTO):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)


class Tokens(DTO):
    access_token: str
    refresh_token: str
    user_id: str


class Refresh(DTO):
    refresh_token: str = Field(max_length=256)


class EvidenceRef(DTO):
    id: UUID
    revision: int = Field(ge=1)


class EntryContent(DTO):
    type: Literal["note", "event"] = "note"
    text: str | None = Field(default=None, max_length=50000)
    occurred_at: datetime
    tags: list[str] = Field(default_factory=list, max_length=30)
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def meaningful(self):
        if not (self.text and self.text.strip()) and not self.metadata:
            raise ValueError("Entry needs text or structured metadata")
        if self.occurred_at.tzinfo is None:
            raise ValueError("occurred_at must include timezone")
        return self


class KnowledgeContent(DTO):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=20000)
    status: Literal[
        "draft", "active", "supported", "weakened", "rejected", "archived", "completed", "cancelled"
    ] = "draft"
    confidence: float = Field(default=0, ge=0, le=1)
    evidence: list[EvidenceRef] = Field(min_length=1, max_length=100)
    alternatives: list[str] = Field(default_factory=list, max_length=20)
    hypothesis_id: UUID | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    success_criteria: str = Field(default="", max_length=5000)
    result: str = Field(default="", max_length=10000)
    observations: list[str] = Field(default_factory=list, max_length=100)
    questions: list[str] = Field(default_factory=list, max_length=20)


class EntryMutation(DTO):
    operation_id: UUID
    id: UUID
    base_revision: int = Field(ge=0)
    content: EntryContent
    deleted: bool = False


class KnowledgeMutation(DTO):
    operation_id: UUID
    id: UUID
    base_revision: int = Field(ge=0)
    content: KnowledgeContent
    deleted: bool = False


class EntityOut(DTO):
    id: str
    kind: str
    content: dict
    revision: int
    source: str
    created_at: str
    updated_at: str
    deleted_at: str | None


class JobRequest(DTO):
    operation_id: UUID
    kind: Literal[
        "structured_entry", "pattern", "hypothesis", "experiment_suggestion", "weekly_review"
    ]
    sources: list[EvidenceRef] = Field(min_length=1, max_length=100)
    period_start: datetime | None = None
    period_end: datetime | None = None

    @model_validator(mode="after")
    def review_period(self):
        if self.kind == "weekly_review":
            if not self.period_start or not self.period_end:
                raise ValueError("Weekly review requires explicit period")
            if not self.period_start.tzinfo or not self.period_end.tzinfo:
                raise ValueError("Period must include timezone")
            if not 0 < (self.period_end - self.period_start).total_seconds() <= 7 * 86400:
                raise ValueError("Review period must not exceed seven days")
        return self


class AIResult(DTO):
    items: list[KnowledgeContent] = Field(max_length=20)


Mutation = Annotated[EntryMutation | KnowledgeMutation, Field(union_mode="left_to_right")]
