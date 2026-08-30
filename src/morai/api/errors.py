"""The request id, and the opaque error envelope that structurally cannot leak (D-10).

A validation error is the code path most likely to have a secret in scope (`NN-34`) --
Phase 4 puts real Schwab tokens through this exact envelope, so it has to be safe
*before* there is anything valuable to leak. Both handlers below return exactly
`{"error": "internal", "request_id": "..."}` and nothing else.

The server log gets field *locations* and failure types, keyed by that same id -- never
the submitted values. `ResponseValidationError.errors()` attaches an `input` key
holding the offending value, and on the response path that value is an object this
system built, which in Phase 4 holds a Schwab access token. Logging the error list
whole would put it in the Railway log, and `NN-34` forbids that outright. See
`_redacted_error_locations`, and note that `exc_info` is omitted on that handler for
the same reason: a formatted traceback ends with `str(exc)`, which re-renders the very
inputs being suppressed.

The 422 path (`RequestValidationError`) is deliberately untouched. That detail names
the *client's* own field and its own submitted value -- nothing server-side is in
scope there, and suppressing it would make a strict API undebuggable for the client
that has to satisfy it.

Request-id propagation uses a `contextvars.ContextVar`, not `request.state`.
`Request.state` (`starlette.datastructures.State`) is a dynamic `__getattr__` bag
typed to return `Any` on every read -- exactly what this project's `reportAny` gate
exists to catch. A `ContextVar[str]` is fully typed and, because Starlette runs a
request through a single `await` chain with no new `asyncio.Task`, is visible to any
exception handler invoked while unwinding that same chain -- which is exactly the
`ResponseValidationError` case: `add_exception_handler(ResponseValidationError, ...)`
is dispatched by Starlette's `ExceptionMiddleware`, nested *inside* this middleware's
own `call_next`, so the id this middleware set is still current when that handler
reads it, and the response ends up with a matching id in both the header and the body.

A handler registered for the bare `Exception` class is dispatched differently: FastAPI
special-cases the `Exception`/`500` key to Starlette's outer `ServerErrorMiddleware`
(`Starlette.build_middleware_stack`), which sits *outside* this middleware and always
re-raises the exception after sending the response, so a process supervisor still sees
and logs the crash. By the time that handler runs, this middleware's `call_next` has
already unwound past its `finally` and reset the context var, so
`unhandled_exception_handler` falls back to a fresh id -- correct, since no header was
ever written for that response either. httpx's `ASGITransport` re-raises the exception
back to the caller by default (`raise_app_exceptions=True`); observing that response in
a test needs `raise_app_exceptions=False`.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from contextvars import ContextVar

from fastapi import FastAPI, Request
from fastapi.exceptions import ResponseValidationError
from pydantic import BaseModel, ConfigDict, TypeAdapter
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)


class _ErrorLocation(BaseModel):
    """One validation error, reduced to the two fields that are safe to log.

    `extra="ignore"` is the point of this model. Pydantic's error dicts also carry
    `input` -- the offending value -- along with `msg` and `url`. Declaring only `loc`
    and `type` means the value is dropped at the parse boundary and is not present in
    the object the logger is handed. The redaction is structural, not a discipline
    someone has to remember at each call site."""

    model_config = ConfigDict(extra="ignore")

    loc: tuple[str | int, ...] = ()
    type: str = "unknown"


_ERROR_LIST: TypeAdapter[list[_ErrorLocation]] = TypeAdapter(list[_ErrorLocation])

REQUEST_ID_HEADER = "X-Request-Id"

_request_id_ctx: ContextVar[str] = ContextVar("request_id")


def _current_request_id() -> str:
    """The id set by `request_id_middleware` for this request, or a fresh one if
    that middleware's scope has already unwound (the bare-`Exception` path)."""
    try:
        return _request_id_ctx.get()
    except LookupError:
        return uuid.uuid4().hex


def _opaque_500(request_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=500, content={"error": "internal", "request_id": request_id}
    )


def _redacted_error_locations(exc: Exception) -> list[str]:
    """Field locations and failure types from a validation error. Never the values.

    `ResponseValidationError.errors()` attaches an `input` key holding the offending
    value, and for a *response* model that value is an object this system built. In
    Phase 4 that object carries a Schwab access token. Logging the error list whole
    would write it to the Railway log, which `NN-34` forbids outright -- an OAuth code
    or app secret is bearer-equivalent and is never rendered, never logged, never
    echoed in an error.

    `exc_info` is deliberately omitted at the call site for the same reason: the
    formatted traceback ends with `str(exc)`, which re-renders those same inputs. The
    request id plus the route path are enough to find the failure; the value is not
    needed to fix a shape mismatch. This mirrors `settings.load_settings`, which hit
    the identical trap on the configuration path.
    """
    if not isinstance(exc, ResponseValidationError):
        return [type(exc).__name__]
    # `errors()` is untyped, so every element reads as Any and trips reportAny. A
    # TypeAdapter is the narrowing this project allows -- unlike cast it actually
    # checks the shape at runtime instead of asserting it to the checker.
    return [
        "{}: {}".format(".".join(str(part) for part in d.loc) or "<root>", d.type)
        for d in _ERROR_LIST.validate_python(exc.errors())
    ]


async def request_id_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Every response carries a request id: generated once here, and set as a
    response header on the way back out."""
    request_id = uuid.uuid4().hex
    token = _request_id_ctx.set(request_id)
    try:
        response = await call_next(request)
    finally:
        _request_id_ctx.reset(token)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response


async def response_validation_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """A route's own output failed to match its declared contract -- criterion 5's
    actual gap (a silently-dropped extra field, or a coercion `response_model`
    alone would let through). Registered only for `ResponseValidationError`, so
    `exc` is always that type at runtime; narrowed via `isinstance` rather than
    typed as the subclass directly, since Starlette's `ExceptionHandler` alias is
    itself typed against the base `Exception`."""
    request_id = _current_request_id()
    logger.error(
        "response validation failed request_id=%s path=%s detail=%s",
        request_id,
        request.url.path,
        _redacted_error_locations(exc),
    )
    return _opaque_500(request_id)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Anything else that escapes a route -- same opaque shape, same log
    discipline. Whatever was in scope when this fired might be a secret; the body
    must never be able to carry it."""
    request_id = _current_request_id()
    logger.error("unhandled exception request_id=%s", request_id, exc_info=exc)
    return _opaque_500(request_id)


def install_error_handling(app: FastAPI) -> None:
    """Wire the request-id middleware and both opaque handlers onto `app` at
    construction."""
    app.add_middleware(BaseHTTPMiddleware, dispatch=request_id_middleware)
    app.add_exception_handler(
        ResponseValidationError, response_validation_exception_handler
    )
    app.add_exception_handler(Exception, unhandled_exception_handler)
