"""
News-Agents SSE endpoint.

POST /api/news-agents
Body (JSON):
    dataset       str   — CSV filename currently loaded
    anomaly_date  str   — ISO date of the flagged anomaly (e.g. "2023-04-11")
    keywords      list  — search keywords (auto-populated by frontend)
    language      str   — (unused for now, kept for future i18n)

Returns: text/event-stream  (Server-Sent Events)

Each SSE message has the form:
    data: <JSON string>\n\n
where the JSON string is { event: "...", data: "..." }
"""

import json
import logging
from flask import Blueprint, request, Response, stream_with_context

from ..services.news_agent_service import run_news_agents

logger = logging.getLogger(__name__)

news_agents_bp = Blueprint("news_agents", __name__)


def _sse(payload: dict) -> str:
    """Encode a dict as a single SSE message."""
    return f"data: {json.dumps(payload)}\n\n"


@news_agents_bp.route("/api/news-agents", methods=["POST"])
def news_agents_stream():
    """
    Stream the 3-agent debate as Server-Sent Events.

    The client opens an EventSource-compatible POST by calling fetch() with
    the ReadableStream API (since EventSource only does GET).
    """
    try:
        body = request.get_json(force=True) or {}
    except Exception:
        body = {}

    dataset = body.get("dataset", "unknown_dataset")
    anomaly_date = body.get("anomaly_date", "unknown_date")
    keywords = body.get("keywords", ["ATM", "cash", "NatWest"])
    language = body.get("language", "English")

    # Validate keywords
    if not isinstance(keywords, list) or not keywords:
        keywords = ["ATM", "cash", "NatWest", "retail banking"]

    keywords = [str(k).strip() for k in keywords if str(k).strip()][:8]

    def generate():
        try:
            for event_dict in run_news_agents(
                keywords=keywords,
                anomaly_date=anomaly_date,
                dataset=dataset,
                language=language,
            ):
                yield _sse(event_dict)
        except Exception as exc:
            logger.exception("News-agents stream error")
            yield _sse({"event": "error", "data": str(exc)})
        finally:
            yield _sse({"event": "done", "data": "stream_end"})

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
