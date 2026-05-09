"""
Multi-agent news intelligence service using CrewAI + Gemini.

Runs three agents sequentially:
  1. News Analyst   — reads headlines and summarises their impact
  2. Devil's Advocate — challenges the Analyst's conclusions
  3. Synthesizer    — reconciles both views into an actionable recommendation

Each agent message is yielded as a Server-Sent Event dict so the Flask
route can stream it directly to the browser.

NOTE ON CrewAI LLM:
  CrewAI 1.x requires its own LLM wrapper (crewai.LLM), NOT LangChain's
  ChatGoogleGenerativeAI. Pass the model name as "gemini/gemini-2.5-flash"
  so that CrewAI's litellm backend can route it correctly.
"""

import os
import json
import logging
import re
from typing import Iterator, List, Dict

from .news_fetcher import fetch_headlines

logger = logging.getLogger(__name__)

# ── CrewAI-native LLM ────────────────────────────────────────────────────────

def _make_llm():
    """
    Build a CrewAI-native LLM for Gemini.

    Uses gemini-2.5-flash — the current stable, non-deprecated model per
    https://ai.google.dev/gemini-api/docs/models. max_retries lets litellm
    automatically retry a single transient 429 before giving up.
    """
    from crewai import LLM  # type: ignore

    return LLM(
        model="gemini/gemini-2.5-flash",
        api_key=os.getenv("GEMINI_API_KEY", ""),
        temperature=0.7,
        max_retries=1,
    )


# ── Agent / Task helpers ─────────────────────────────────────────────────────

def _make_analyst(llm, headlines_text: str, context: str):
    from crewai import Agent, Task  # type: ignore

    agent = Agent(
        role="Senior Financial Journalist",
        goal=(
            "Analyse the provided news headlines and explain their likely "
            "impact on ATM cash demand and retail banking operations."
        ),
        backstory=(
            "You are a seasoned financial journalist with 15 years covering "
            "UK retail banking. You translate complex economic data into "
            "clear, actionable insights for branch managers."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=True,
    )

    task = Task(
        description=(
            f"Context: {context}\n\n"
            f"Recent headlines:\n{headlines_text}\n\n"
            "Summarise what these headlines tell us about current demand "
            "drivers. Be specific, reference the headlines, and mention any "
            "seasonal, economic, or event-driven factors. Keep it to "
            "3-4 concise paragraphs."
        ),
        expected_output=(
            "A focused 3-4 paragraph analysis referencing specific headlines "
            "and their likely impact on cash/ATM demand."
        ),
        agent=agent,
    )
    return agent, task


def _make_skeptic(llm, context: str):
    from crewai import Agent, Task  # type: ignore

    agent = Agent(
        role="Risk & Compliance Officer",
        goal=(
            "Challenge the Analyst's conclusions, identify contradicting "
            "evidence, and flag any risks or alternative explanations."
        ),
        backstory=(
            "You are a sharp risk officer who has seen many over-confident "
            "forecasts lead to costly replenishment errors. Your job is to "
            "stress-test assumptions and surface blind spots."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=True,
    )

    task = Task(
        description=(
            f"Context: {context}\n\n"
            "Review the Analyst's summary (from previous task output). "
            "Identify at least two potential counter-arguments or risks:\n"
            "- Are there localised factors the Analyst may have missed?\n"
            "- Could the news be lagging or misleading?\n"
            "- What fraud or operational risks might arise?\n"
            "Keep it to 2-3 sharp paragraphs."
        ),
        expected_output=(
            "2-3 paragraph critique identifying counter-evidence, "
            "alternative explanations, and specific risk flags."
        ),
        agent=agent,
    )
    return agent, task


def _make_synthesizer(llm, context: str):
    from crewai import Agent, Task  # type: ignore

    agent = Agent(
        role="Branch Strategy Advisor",
        goal=(
            "Reconcile the Analyst and Devil's Advocate views into a "
            "single, practical recommendation with a confidence score "
            "and structured JSON output."
        ),
        backstory=(
            "You advise NatWest branch managers on operational decisions. "
            "You are pragmatic, data-driven, and always produce clear "
            "action plans that balance opportunity and risk."
        ),
        llm=llm,
        verbose=False,
        allow_delegation=True,
    )

    task = Task(
        description=(
            f"Context: {context}\n\n"
            "Read both the Analyst's summary and the Devil's Advocate's "
            "critique (from previous task outputs). Produce:\n"
            "1. A 2-paragraph consensus statement.\n"
            "2. A structured JSON block (wrapped in ```json ... ```) with:\n"
            "   {\n"
            '     "trend_direction": "bullish" | "bearish" | "neutral",\n'
            '     "confidence": <integer 0-100>,\n'
            '     "action": "<one-sentence action for the branch manager>",\n'
            '     "risk_level": "low" | "medium" | "high",\n'
            '     "replenishment_adjustment": "<e.g. +20% for the 3 days following the anomaly>",\n'
            '     "key_drivers": ["driver1", "driver2"],\n'
            '     "watch_out_for": ["risk1", "risk2"]\n'
            "   }"
        ),
        expected_output=(
            "2-paragraph consensus followed by a ```json block with the "
            "structured forecast fields."
        ),
        agent=agent,
    )
    return agent, task


# ── Streaming runner ─────────────────────────────────────────────────────────

def run_news_agents(
    keywords: List[str],
    anomaly_date: str,
    dataset: str,
    language: str = "English",
) -> Iterator[Dict]:
    """
    Run the 3-agent pipeline and yield SSE-compatible dicts.

    Each yielded dict has:
        { "event": "analyst"|"skeptic"|"synthesizer"|"forecast"|"error"|"done",
          "data": <str or dict> }
    """

    # 1. Fetch headlines ───────────────────────────────────────────────────
    yield {"event": "status", "data": "🔍 Fetching latest headlines…"}

    articles = fetch_headlines(keywords, anomaly_date)

    if articles:
        headlines_text = "\n".join(
            f"• [{a['source']}] {a['title']} — {(a.get('description') or '')[:120]}"
            for a in articles
        )
        yield {
            "event": "headlines",
            "data": json.dumps(
                [{"title": a["title"], "source": a["source"], "url": a["url"]}
                 for a in articles]
            ),
        }
    else:
        # Graceful fallback — agents still run with generic UK retail context
        headlines_text = (
            "No live headlines retrieved. Use your general knowledge about "
            "UK retail banking, ATM usage patterns, and seasonal demand "
            f"for the date {anomaly_date} and keywords: {', '.join(keywords)}."
        )
        yield {
            "event": "status",
            "data": "⚠️ No live headlines found — agents will use domain knowledge.",
        }

    context = (
        f"Dataset: {dataset} | Anomaly date: {anomaly_date} | "
        f"Keywords analysed: {', '.join(keywords)}"
    )

    # 2. Build agents ──────────────────────────────────────────────────────
    try:
        from crewai import Crew, Process  # type: ignore

        llm = _make_llm()
        analyst_agent, analyst_task = _make_analyst(llm, headlines_text, context)
        skeptic_agent, skeptic_task = _make_skeptic(llm, context)
        synth_agent, synth_task = _make_synthesizer(llm, context)

    except Exception as exc:
        logger.exception("CrewAI setup error")
        yield {"event": "error", "data": f"Agent setup failed: {exc}"}
        return

    # 3. Run agents one by one, streaming each result ──────────────────────
    agent_events = [
        ("analyst",     "📰 News Analyst",    analyst_agent, analyst_task),
        ("skeptic",     "🔥 Devil's Advocate", skeptic_agent, skeptic_task),
        ("synthesizer", "🧠 Synthesizer",      synth_agent,   synth_task),
    ]

    completed_tasks = []
    last_output_text = ""

    for event_name, label, agent, task in agent_events:
        yield {"event": "agent_start", "data": json.dumps({"agent": event_name, "label": label})}

        try:
            from crewai import Crew, Process  # type: ignore

            # Feed completed tasks as context so each agent sees prior work
            if completed_tasks:
                task.context = completed_tasks  # type: ignore[attr-defined]

            mini_crew = Crew(
                agents=[agent],
                tasks=[task],
                process=Process.sequential,
                verbose=False,
            )
            result = mini_crew.kickoff()
            output_text = str(result).strip()
            last_output_text = output_text
            completed_tasks.append(task)

        except Exception as exc:
            logger.warning("Agent %s error: %s", event_name, exc)
            output_text = (
                f"[{label} could not complete its analysis due to: {exc}. "
                "Continuing with available context.]"
            )
            last_output_text = output_text

        yield {
            "event": event_name,
            "data": json.dumps({"label": label, "content": output_text}),
        }

    # 4. Extract structured JSON from Synthesizer output ──────────────────
    forecast_json = None
    match = re.search(r"```json\s*(\{.*?\})\s*```", last_output_text, re.DOTALL)
    if match:
        try:
            forecast_json = json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    if not forecast_json:
        forecast_json = {
            "trend_direction": "neutral",
            "confidence": 60,
            "action": "Monitor demand closely and maintain standard replenishment.",
            "risk_level": "medium",
            "replenishment_adjustment": "No change recommended",
            "key_drivers": keywords[:2],
            "watch_out_for": ["Data availability", "Model uncertainty"],
        }

    yield {"event": "forecast", "data": json.dumps(forecast_json)}
    yield {"event": "done", "data": "Analysis complete."}
