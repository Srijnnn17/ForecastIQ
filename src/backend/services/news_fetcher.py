"""
News fetcher service.

Fetches relevant headlines from NewsAPI.org (primary) with an optional
GNews fallback. Results are cached for 15 minutes per unique query so we
stay well within the free-tier rate limits.

DATE LOGIC:
  To understand WHY an anomaly occurred, we look at the 4 days BEFORE it
  (not the day itself, which would already be too late — e.g. an Easter surge
  starts being reported in the days before Easter Sunday). This 'look-back'
  window is applied to the NewsAPI 'from'/'to' parameters.
"""

import os
import time
import hashlib
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ── In-process cache (keyed by query hash) ──────────────────────────────────
_CACHE: Dict[str, Dict] = {}
_CACHE_TTL = 15 * 60  # 15 minutes


def _cache_key(*args) -> str:
    joined = "|".join(str(a) for a in args)
    return hashlib.md5(joined.encode()).hexdigest()


def _cached(key: str):
    entry = _CACHE.get(key)
    if entry and (time.time() - entry["ts"]) < _CACHE_TTL:
        return entry["data"]
    return None


def _store(key: str, data):
    _CACHE[key] = {"ts": time.time(), "data": data}


def _date_window(anomaly_date: Optional[str], lookback_days: int = 4):
    """
    Return (from_date_str, to_date_str) for the lookback window.

    We look at [anomaly_date - lookback_days, anomaly_date - 1 day] so we
    capture the build-up events that *caused* the anomaly (e.g. Easter/Bank
    Holiday announcements in the days leading up to the spike).

    If anomaly_date is None or unparseable, returns (None, None) and the
    caller will fetch without a date filter.
    """
    if not anomaly_date:
        return None, None
    try:
        dt = datetime.strptime(anomaly_date[:10], "%Y-%m-%d")
        to_dt   = dt - timedelta(days=1)          # day before anomaly
        from_dt = dt - timedelta(days=lookback_days)  # 4 days before anomaly
        return from_dt.strftime("%Y-%m-%d"), to_dt.strftime("%Y-%m-%d")
    except ValueError:
        return None, None


# ── NewsAPI ──────────────────────────────────────────────────────────────────

def _fetch_newsapi(
    keywords: List[str],
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> List[Dict]:
    """
    Fetch articles from NewsAPI.org using plain urllib (no extra package).

    Free-plan note: /v2/everything is blocked server-side (HTTP 426).
    Falls back to /v2/top-headlines automatically, which IS available on
    the free Developer plan.
    """
    api_key = os.getenv("NEWS_API_KEY", "")
    if not api_key:
        return []

    try:
        import urllib.request
        import urllib.parse
        import json as _json

        def _parse_articles(data):
            return [
                {
                    "title":        (a.get("title") or ""),
                    "description":  (a.get("description") or ""),
                    "source":       (a.get("source") or {}).get("name") or "NewsAPI",
                    "url":          (a.get("url") or ""),
                    "published_at": (a.get("publishedAt") or ""),
                }
                for a in data.get("articles", [])
                if (a.get("title") or "") and "[Removed]" not in (a.get("title") or "")
            ]

        def _get(url):
            req = urllib.request.Request(
                url, headers={"User-Agent": "ForecastIQ/1.0"}
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                return _json.loads(resp.read().decode())

        q = urllib.parse.quote(" OR ".join(f'"{k}"' for k in keywords[:5]))

        # ── Primary: /v2/everything (richer results, date-filterable) ──────
        url = (
            f"https://newsapi.org/v2/everything"
            f"?q={q}&language=en&sortBy=relevancy&pageSize=10"
            f"&apiKey={api_key}"
        )
        if from_date:
            url += f"&from={from_date}"
        if to_date:
            url += f"&to={to_date}"

        try:
            data = _get(url)
            articles = _parse_articles(data)
            if articles:
                logger.info("NewsAPI /everything: %d articles", len(articles))
                return articles
        except Exception as e:
            if "426" in str(e) or "403" in str(e) or "401" in str(e):
                logger.info(
                    "NewsAPI /everything blocked (%s) — falling back to /top-headlines", e
                )
            else:
                raise  # unexpected error, let outer handler log it

        # ── Fallback: /v2/top-headlines (free-plan friendly) ────────────────
        q_simple = urllib.parse.quote(" ".join(keywords[:3]))
        url_top = (
            f"https://newsapi.org/v2/top-headlines"
            f"?q={q_simple}&language=en&pageSize=10"
            f"&apiKey={api_key}"
        )
        data = _get(url_top)
        articles = _parse_articles(data)
        logger.info("NewsAPI /top-headlines: %d articles", len(articles))
        return articles

    except Exception as exc:
        logger.warning("NewsAPI fetch failed: %s", exc)
        return []


# ── GNews fallback ───────────────────────────────────────────────────────────

def _fetch_gnews(
    keywords: List[str],
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> List[Dict]:
    """
    Fetch articles from GNews.io /api/v4/search.

    Documented URL pattern (https://gnews.io/docs/v4):
        https://gnews.io/api/v4/search?q=<query>&lang=en&max=10&apikey=<key>

    Bugs fixed vs previous version:
    - Removed `country=gb` — that param is only valid on /top-headlines,
      not /search. Passing it to /search returns HTTP 403.
    - Removed from/to date params — free plan does not support date
      filtering; adding them returns HTTP 403 on free tier.
    - Added User-Agent header — bare urllib requests sometimes get blocked.
    - Fixed source field: GNews returns {"source": {"name": "...", "url": "..."}}
    - Fixed published_at: GNews field is `publishedAt`, not `published_at`.
    """
    api_key = os.getenv("GNEWS_API_KEY", "")
    if not api_key:
        return []

    try:
        import urllib.request
        import urllib.parse
        import json

        query = urllib.parse.quote(" ".join(keywords[:4]))
        url = (
            f"https://gnews.io/api/v4/search"
            f"?q={query}&lang=en&max=10&apikey={api_key}"
        )

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 ForecastIQ/1.0",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        articles = data.get("articles", [])
        logger.info("GNews /search: %d articles for keywords=%s", len(articles), keywords)
        return [
            {
                "title":        (a.get("title") or ""),
                "description":  (a.get("description") or ""),
                "source":       (a.get("source") or {}).get("name") or "GNews",
                "url":          (a.get("url") or ""),
                "published_at": (a.get("publishedAt") or ""),
            }
            for a in articles
            if (a.get("title") or "")
        ]
    except Exception as exc:
        logger.warning("GNews fetch failed: %s", exc)
        return []



# ── Public API ────────────────────────────────────────────────────────────────

def fetch_headlines(
    keywords: List[str],
    anomaly_date: Optional[str] = None,
    max_articles: int = 8,
    lookback_days: int = 4,
) -> List[Dict]:
    """
    Fetch and return up to *max_articles* relevant headlines from the
    4-day window BEFORE the anomaly date.

    Rationale: anomalies like Easter surges, bank-holiday spikes, or strike
    actions are driven by events that are *reported in advance*. Fetching
    news on the anomaly day itself misses the build-up context. By looking
    at [anomaly_date - 4 days, anomaly_date - 1 day] we capture the
    anticipatory reporting that explains the spike.

    Falls back to GNews if NewsAPI returns nothing.
    Results are cached for 15 minutes.
    """
    from_date, to_date = _date_window(anomaly_date, lookback_days)
    key = _cache_key(*sorted(keywords), anomaly_date or "", from_date or "", to_date or "")

    cached = _cached(key)
    if cached is not None:
        logger.info("News cache HIT for key=%s", key)
        return cached

    logger.info(
        "Fetching news | keywords=%s | window=[%s → %s]",
        keywords, from_date or "any", to_date or "any"
    )

    articles = _fetch_newsapi(keywords, from_date, to_date)
    if not articles:
        # If dated fetch yielded nothing, try without date filter as fallback
        logger.info("No dated results — retrying NewsAPI without date filter")
        articles = _fetch_newsapi(keywords)

    if not articles:
        articles = _fetch_gnews(keywords, from_date, to_date)

    if not articles:
        logger.info("No dated GNews results — retrying GNews without date filter")
        articles = _fetch_gnews(keywords)

    # Deduplicate by title
    seen: set = set()
    unique: List[Dict] = []
    for a in articles:
        t = a["title"]
        if t and t not in seen:
            seen.add(t)
            unique.append(a)

    result = unique[:max_articles]
    _store(key, result)
    logger.info("Cached %d articles for keywords=%s window=[%s → %s]",
                len(result), keywords, from_date, to_date)
    return result
