"""The request id, and the opaque error envelope that structurally cannot leak (D-10).

A validation error is the code path most likely to have a secret in scope (`NN-34`) --
Phase 4 puts real Schwab tokens through this exact envelope, so it has to be safe
*before* there is anything valuable to leak. Both handlers below return exactly
`{"error": "internal", "request_id": "..."}` and nothing else; the full detail (field
names, submitted values, the Pydantic message) goes to the server log only, keyed by
that same id.

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
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

logger = logging.getLogger(__name__)

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
    detail = exc.errors() if isinstance(exc, ResponseValidationError) else str(exc)
    logger.error(
        "response validation failed request_id=%s detail=%s",
        request_id,
        detail,
        exc_info=exc,
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
    # TODO(01-06 red commit): not yet wired.
