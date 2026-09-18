import pytest
from app.ai import TransientProviderError, generate
from app.schemas import AIResult
from pydantic import ValidationError


class Fake:
    name = "fake"
    model = "test"

    def __init__(self, result):
        self.result = result
        self.calls = 0

    async def generate(self, kind, sources):
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


async def test_transient_fallback_only():
    first = Fake(TransientProviderError())
    second = Fake(AIResult(items=[]))
    assert (await generate("pattern", [], [first, second]))[0].items == []
    assert second.calls == 1
    second.calls = 0
    with pytest.raises(ValueError):
        await generate("pattern", [], [Fake(ValueError("invalid")), second])
    assert second.calls == 0


def test_strict_result():
    with pytest.raises(ValidationError):
        AIResult.model_validate({"items": [{"title": "Unsupported", "evidence": []}]})


async def test_invented_evidence_rejected():
    result = AIResult.model_validate(
        {
            "items": [
                {
                    "title": "Bad",
                    "evidence": [{"id": "00000000-0000-4000-8000-000000000001", "revision": 1}],
                }
            ]
        }
    )
    with pytest.raises(ValueError):
        await generate("pattern", [], [Fake(result)])
