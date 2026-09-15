"""
Error handling that keeps real error messages visible to the browser.

FastAPI's catch-all exception handler runs outside CORSMiddleware, so an
unhandled exception used to reach the browser as a 500 without CORS headers —
which fetch() reports as an opaque "Failed to fetch". `ErrorMiddleware` is
registered inside CORSMiddleware instead, so the JSON error it returns always
carries CORS headers.
"""

import json
import logging
import os
import uuid
from typing import Any, Generator

from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("choir")


def expose_error_details() -> bool:
    """Show exception text to the client everywhere except production."""
    return os.getenv("APP_ENV", "development").lower() != "production"


def describe_error(exc: BaseException, request_id: str) -> str:
    if expose_error_details():
        return f"{type(exc).__name__}: {exc} (request {request_id})"
    return f"Something went wrong on our side. Request id: {request_id}"


class ErrorMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid.uuid4().hex[:12]
        response_started = False

        async def send_with_request_id(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception as exc:
            logger.exception("Unhandled error on %s %s (request %s)", scope["method"], scope["path"], request_id)
            if response_started:
                # Headers are already on the wire (e.g. a streaming response); nothing more we can send.
                raise
            body = json.dumps({"detail": describe_error(exc, request_id), "request_id": request_id}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                        (b"x-request-id", request_id.encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})


def safe_sse_stream(stream: Generator[str, None, None]) -> Generator[str, None, None]:
    """
    A streaming response has already sent its headers when the generator runs,
    so ErrorMiddleware can't turn a failure there into a JSON error. Send it as
    an SSE error frame instead, which the chat input already displays.
    """
    try:
        yield from stream
    except Exception as exc:
        request_id = uuid.uuid4().hex[:12]
        logger.exception("Unhandled error while streaming (request %s)", request_id)
        payload: dict[str, Any] = {"error": describe_error(exc, request_id)}
        yield f"data: {json.dumps(payload)}\n\n"
