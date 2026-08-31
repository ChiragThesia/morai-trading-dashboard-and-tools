"""Telemetry must not become the leak that the log and the error body are not.

`morai.api.errors` withholds values from the client body and from the server log, and
`morai.settings.load_settings` withholds them from the boot error. A third-party
analytics vendor is the least appropriate destination of all for a bearer-equivalent
secret (`NN-34`), so the same discipline is asserted here.

The canary strings below are synthetic. No real credential appears in any test.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from pydantic import BaseModel, ValidationError

from morai import telemetry

SECRET = "sk-test-fake-NOTAREALCREDENTIAL-0000000000000000"


@dataclass
class _Call:
    distinct_id: str
    event: str
    properties: dict[str, object]


@dataclass
class _FakeClient:
    """Stands in for `posthog.Posthog`, recording what would have been sent."""

    calls: list[_Call] = field(default_factory=list)

    def capture(
        self, *, distinct_id: str, event: str, properties: dict[str, object]
    ) -> None:
        self.calls.append(_Call(distinct_id, event, properties))

    def shutdown(self) -> None:
        return None


@pytest.fixture
def fake_client(monkeypatch: pytest.MonkeyPatch) -> _FakeClient:
    client = _FakeClient()
    telemetry.get_client.cache_clear()
    monkeypatch.setattr(telemetry, "get_client", lambda: client)
    return client


def _validation_error_carrying(secret: str) -> ValidationError:
    """A real pydantic ValidationError whose rendered message contains `secret`.

    Built rather than mocked, because the whole risk is that pydantic's own
    `__str__` embeds the rejected input -- a fake would not reproduce it.
    """

    class Model(BaseModel):
        amount: int

    try:
        Model.model_validate({"amount": secret})
    except ValidationError as exc:
        return exc
    raise AssertionError("expected the model to reject a string for an int field")


def test_the_exception_message_really_does_contain_the_secret() -> None:
    """Control. If pydantic ever stops embedding the input, the test below would pass
    for the wrong reason and silently stop guarding anything."""
    exc = _validation_error_carrying(SECRET)
    assert SECRET in str(exc)


def test_capture_exception_never_sends_the_message(fake_client: _FakeClient) -> None:
    exc = _validation_error_carrying(SECRET)

    telemetry.capture_exception(exc, request_id="req-123", context={"path": "/x"})

    assert fake_client.calls, "nothing was captured, so this test proves nothing"
    payload = repr(fake_client.calls)
    assert SECRET not in payload
    # What it does keep: enough to find the failure.
    props = fake_client.calls[0].properties
    assert props["exception_type"] == "ValidationError"
    assert props["request_id"] == "req-123"
    assert props["path"] == "/x"


def test_capture_exception_sends_frames_but_no_locals(fake_client: _FakeClient) -> None:
    """Frames locate the failure. Locals would re-introduce the value."""

    def _raise_holding_a_secret() -> None:
        # A live local holding a secret at the moment of the raise. Read once so it
        # is genuinely accessed -- the point is that it sits in the frame and still
        # does not reach PostHog, not that it is dead code.
        doomed_local = SECRET
        if not doomed_local:
            raise AssertionError("the canary must be non-empty to prove anything")
        raise RuntimeError("boom")

    try:
        _raise_holding_a_secret()
    except RuntimeError as exc:
        telemetry.capture_exception(exc, request_id="req-456")

    frames = fake_client.calls[0].properties["frames"]
    assert isinstance(frames, str)
    assert "_raise_holding_a_secret" in frames
    assert SECRET not in repr(fake_client.calls)


def test_capture_event_is_a_noop_without_an_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No PostHog account is needed to run this project. With no key configured every
    entry point returns quietly rather than raising or warning."""
    telemetry.get_client.cache_clear()
    monkeypatch.setattr(telemetry, "get_client", lambda: None)

    telemetry.capture_event("user-1", "did_a_thing", {"n": 1})
    telemetry.capture_exception(RuntimeError("x"), request_id="r")
    telemetry.shutdown()


def test_telemetry_never_raises_into_its_caller(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An analytics outage must not take down a trading journal."""

    class _ExplodingClient:
        def capture(self, **_: object) -> None:
            raise ConnectionError("posthog is down")

        def shutdown(self) -> None:
            raise ConnectionError("posthog is down")

    telemetry.get_client.cache_clear()
    monkeypatch.setattr(telemetry, "get_client", lambda: _ExplodingClient())

    telemetry.capture_event("user-1", "did_a_thing")
    telemetry.capture_exception(RuntimeError("x"), request_id="r")
    telemetry.shutdown()
