"""Product analytics and error tracking, via PostHog.

Used by both entry points -- the FastAPI web process and the Procrastinate worker --
so it lives beside them rather than inside either.

Three rules govern everything here.

**Nothing sent to PostHog may carry a secret.** This is `NN-34`, and it is why this
module exists as a wrapper rather than a direct SDK call at each site. An exception's
`str()` is the dangerous part: `ValidationError.__str__` renders each rejected field
*together with its input value*, and on the response path that value is an object this
system built -- in Phase 4, one holding a Schwab access token. So `capture_exception`
sends the exception **type**, its **traceback frames** (file, line, function) and the
**request id**. It never sends the message, never the locals, never the arguments. The
full detail already goes to the server log, itself redacted, and the request id joins
the two. A stack trace tells you where it broke; the value was never what you needed.

**Telemetry never breaks the thing it observes.** Every public function here swallows
its own errors. If PostHog is unreachable, misconfigured or slow, the ledger still
posts, the worker still drains its queue, and the request still returns. An analytics
outage that takes down a trading journal is a self-inflicted wound.

**It is optional.** With no API key configured -- local development, CI, a fresh clone
-- every function is a no-op. Nobody needs a PostHog account to run the tests.
"""

from __future__ import annotations

import logging
import traceback
from functools import lru_cache
from typing import TYPE_CHECKING

from morai.settings import get_settings

if TYPE_CHECKING:
    from posthog import Posthog

logger = logging.getLogger(__name__)

# How many traceback frames to report. Deep enough to locate a failure, shallow enough
# that a runaway recursion does not post a megabyte of identical frames.
_MAX_FRAMES = 30


@lru_cache(maxsize=1)
def get_client() -> Posthog | None:
    """The process-wide PostHog client, or None when no API key is configured.

    Built once. `None` is the normal, supported state in development and CI -- it is
    not an error and is not logged as one.
    """
    settings = get_settings()
    if settings.posthog_api_key is None:
        return None
    try:
        from posthog import Posthog

        return Posthog(
            project_api_key=settings.posthog_api_key.get_secret_value(),
            host=settings.posthog_host,
            # Events are queued and flushed on a background thread, so a slow or
            # unreachable PostHog never blocks a request or a job.
            sync_mode=False,
        )
    except Exception:
        logger.warning("posthog client could not be constructed; telemetry disabled")
        return None


def capture_event(
    distinct_id: str,
    event: str,
    properties: dict[str, str | int | float | bool] | None = None,
) -> None:
    """Record a product event.

    `properties` is typed to scalars deliberately. It is not a place to pass a model, a
    request body or a row -- those are exactly the shapes that smuggle a credential or a
    position out of the system. Pass identifiers and outcomes: a route name, a status
    code, a duration, a count. Never a money value tied to a person, and never anything
    read out of the encrypted columns.

    `distinct_id` should be the opaque user id, never an email address.
    """
    client = get_client()
    if client is None:
        return
    try:
        client.capture(
            distinct_id=distinct_id, event=event, properties=properties or {}
        )
    except Exception:
        # Telemetry is never allowed to raise into a caller.
        logger.debug("posthog capture failed for event %s", event, exc_info=False)


def capture_exception(
    exc: BaseException,
    *,
    request_id: str,
    context: dict[str, str] | None = None,
    distinct_id: str = "system",
) -> None:
    """Record that an exception happened, without recording what was in it.

    Sends the exception type, its traceback frames, the request id and whatever
    `context` the caller passes. Does NOT send `str(exc)`, the exception's arguments, or
    any frame locals.

    That omission is deliberate and is the whole point of this function. Pydantic's
    `ValidationError.__str__` renders every rejected field alongside its input value;
    on the response path that value is an object this system built, and from Phase 4
    onward it can hold a Schwab access token. `NN-34` says a bearer-equivalent secret is
    never rendered, never logged, never echoed in an error -- and a third-party
    analytics vendor is the least appropriate destination of all for one.

    The cost is real: you lose the message. What you keep is the type and the exact line
    it came from, which is what tells you where to look. The redacted detail is in the
    server log under the same `request_id`.

    `context` must be caller-supplied and already safe -- a route path, a task name, a
    status code. Do not pass request bodies or query strings through it.
    """
    client = get_client()
    if client is None:
        return
    try:
        frames = [
            f"{frame.filename}:{frame.lineno} in {frame.name}"
            for frame in traceback.extract_tb(exc.__traceback__)[-_MAX_FRAMES:]
        ]
        properties: dict[str, str | int | float | bool] = {
            "exception_type": type(exc).__name__,
            "exception_module": type(exc).__module__,
            "request_id": request_id,
            "frame_count": len(frames),
            # Joined rather than sent as a list: PostHog property values are scalars,
            # and one string keeps the frames in order and readable in the UI.
            "frames": " | ".join(frames),
        }
        for key, value in (context or {}).items():
            properties[key] = value
        client.capture(
            distinct_id=distinct_id, event="exception", properties=properties
        )
    except Exception:
        logger.debug("posthog exception capture failed", exc_info=False)


def shutdown() -> None:
    """Flush queued events. Call from a process's shutdown path so a clean exit does
    not silently drop the last few events."""
    client = get_client()
    if client is None:
        return
    try:
        client.shutdown()
    except Exception:
        logger.debug("posthog shutdown failed", exc_info=False)
