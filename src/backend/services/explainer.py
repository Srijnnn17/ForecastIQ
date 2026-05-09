"""
AI explanation service using Google Gemini API.

Generates natural-language explanations of forecasting results,
anomalies, and scenario comparisons that are short enough
for non-expert users to understand.

Falls back to template-based explanations when API is unavailable.
"""

import os
from typing import Dict, List, Optional

# Attempt to import Gemini SDK
try:
    import google.generativeai as genai

    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False


def configure_gemini(api_key: str = None):
    """
    Configure the Gemini API client.

    Args:
        api_key: Google Gemini API key. Uses env var if not provided.
    """
    if not GEMINI_AVAILABLE:
        return

    key = api_key or os.getenv("GEMINI_API_KEY", "")
    if key:
        genai.configure(api_key=key)


def explain_forecast(forecast_result: Dict, horizon: int = 4, language: str = "English") -> str:
    """
    Generate a natural-language explanation of a forecast result.

    Args:
        forecast_result: Dictionary from the forecaster service.
        horizon: Number of periods forecasted.
        language: Language for the AI explanation (e.g. 'French', 'German').

    Returns:
        Human-readable explanation string.
    """
    prompt = _build_forecast_prompt(forecast_result, horizon, language)

    explanation = _call_gemini(prompt)
    if explanation:
        return explanation

    # Fallback to template-based explanation (English only)
    return _template_forecast_explanation(forecast_result, horizon)


def explain_anomalies(anomaly_result: Dict, language: str = "English") -> str:
    """
    Generate a natural-language explanation of detected anomalies.

    Args:
        anomaly_result: Dictionary from the anomaly detector.
        language: Language for the AI explanation (e.g. 'Spanish', 'Welsh').

    Returns:
        Human-readable explanation of the anomalies.
    """
    prompt = _build_anomaly_prompt(anomaly_result, language)

    explanation = _call_gemini(prompt)
    if explanation:
        return explanation

    return _template_anomaly_explanation(anomaly_result)


def explain_scenario_comparison(comparison_result: Dict, language: str = "English") -> str:
    """
    Generate a natural-language comparison of forecasting scenarios.

    Args:
        comparison_result: Dictionary from the scenario engine.
        language: Language for the AI explanation (e.g. 'French', 'German').

    Returns:
        Human-readable scenario comparison.
    """
    prompt = _build_scenario_prompt(comparison_result, language)

    explanation = _call_gemini(prompt)
    if explanation:
        return explanation

    return _template_scenario_explanation(comparison_result)


def _call_gemini(prompt: str) -> Optional[str]:
    """
    Call the Gemini API using gemini-2.5-flash — the current stable,
    non-deprecated model per https://ai.google.dev/gemini-api/docs/models.

    On a transient 429 (rate-limit), waits and retries once. If the quota
    is genuinely exhausted the template fallback is used instead.
    """
    if not GEMINI_AVAILABLE or not os.getenv("GEMINI_API_KEY"):
        return None

    import time

    model = genai.GenerativeModel("gemini-2.5-flash")

    for attempt in range(2):   # 1 attempt + 1 retry
        try:
            response = model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            err = str(e)
            is_quota = ("429" in err or "quota" in err.lower() or
                        "rate" in err.lower() or "exhausted" in err.lower())
            if is_quota and attempt == 0:
                print("Gemini rate-limit hit, waiting 15 s before retry…")
                time.sleep(15)
                continue
            print(f"Gemini API error: {e}")
            return None

    return None


def _build_forecast_prompt(result: Dict, horizon: int, language: str = "English") -> str:
    """Build a prompt for forecast explanation."""
    forecast = result.get("forecast", [])
    lower = result.get("lower_bound", [])
    upper = result.get("upper_bound", [])
    summary = result.get("model_summary", {})

    return f"""You are a data analyst explaining a time series forecast to a non-technical business user.
Be concise (3-5 sentences max). Use simple language. Include specific numbers.
IMPORTANT: You MUST respond entirely in {language}. Do not mix languages.

Forecast results for the next {horizon} periods:
- Central estimates: {[round(v, 1) for v in forecast]}
- Lower bound (pessimistic): {[round(v, 1) for v in lower]}
- Upper bound (optimistic): {[round(v, 1) for v in upper]}
- Model accuracy (MAPE): {summary.get('mape', 'N/A')}%
- Method: {summary.get('method', 'Statistical model')}

Explain what the forecast shows, the level of uncertainty, and any trend.
Do NOT use technical jargon. Write as if explaining to a manager."""


def _build_anomaly_prompt(result: Dict, language: str = "English") -> str:
    """Build a prompt for anomaly explanation."""
    anomalies = result.get("anomalies", [])
    summary_data = result.get("summary", {})

    anomaly_details = []
    for a in anomalies[:5]:  # Limit to top 5
        anomaly_details.append(
            f"  - {a['date']}: value={a['value']}, "
            f"direction={a['direction']}, severity={a['severity']}, "
            f"deviation={a['deviation_pct']}%"
        )

    return f"""You are a data analyst explaining anomalies found in time series data to a non-technical user.
Be concise (3-5 sentences). Explain what happened, why it matters, and suggest next steps.
IMPORTANT: You MUST respond entirely in {language}. Do not mix languages.

Anomaly detection summary:
- Total data points: {summary_data.get('total_points', 'N/A')}
- Anomalies found: {len(anomalies)}
- Critical events: {summary_data.get('critical_count', 0)}
- Warnings: {summary_data.get('warning_count', 0)}

Top anomalies:
{chr(10).join(anomaly_details)}

Explain what these anomalies mean and what the user should investigate.
Suggest specific next steps. Do NOT use technical jargon."""


def _build_scenario_prompt(result: Dict, language: str = "English") -> str:
    """Build a prompt for scenario comparison explanation."""
    comparison = result.get("comparison", {})
    scenarios = comparison.get("scenarios", [])

    scenario_details = []
    for s in scenarios:
        scenario_details.append(
            f"  - {s['name']}: total={s['total_forecast']}, "
            f"difference={s['difference_pct']}% vs baseline"
        )

    return f"""You are a data analyst explaining scenario forecasting results to a non-technical business user.
Be concise (3-5 sentences). Compare the scenarios clearly.
IMPORTANT: You MUST respond entirely in {language}. Do not mix languages.

Baseline forecast total: {comparison.get('baseline_total', 'N/A')}

Scenarios:
{chr(10).join(scenario_details)}

Explain the key differences between scenarios and which seems most favorable.
Do NOT use technical jargon. Write as if explaining to a decision-maker."""


def _template_forecast_explanation(result: Dict, horizon: int) -> str:
    """Generate a template-based forecast explanation (fallback)."""
    forecast = result.get("forecast", [])
    lower = result.get("lower_bound", [])
    upper = result.get("upper_bound", [])

    if not forecast:
        return "No forecast data available."

    avg_forecast = sum(forecast) / len(forecast)
    first_val = forecast[0]
    last_val = forecast[-1]
    growth = ((last_val - first_val) / first_val * 100) if first_val != 0 else 0

    avg_lower = sum(lower) / len(lower) if lower else avg_forecast * 0.9
    avg_upper = sum(upper) / len(upper) if upper else avg_forecast * 1.1

    direction = "growth" if growth > 0 else "decline" if growth < 0 else "stable trend"

    return (
        f"Over the next {horizon} periods, we expect an average value of "
        f"{avg_forecast:,.0f} with a {direction} of approximately {abs(growth):.1f}%. "
        f"In a pessimistic scenario, values could go as low as {avg_lower:,.0f}, "
        f"while in an optimistic scenario they could reach {avg_upper:,.0f}. "
        f"The forecast range reflects the inherent uncertainty in predictions — "
        f"a wider range means less certainty about exact outcomes."
    )


def _template_anomaly_explanation(result: Dict) -> str:
    """Generate a template-based anomaly explanation (fallback)."""
    anomalies = result.get("anomalies", [])
    summary_data = result.get("summary", {})

    if not anomalies:
        return (
            "No significant anomalies were detected in the data. "
            "All values fall within the expected range."
        )

    critical = summary_data.get("critical_count", 0)
    warnings = summary_data.get("warning_count", 0)
    spikes = summary_data.get("spike_count", 0)
    dips = summary_data.get("dip_count", 0)

    parts = [f"We found {len(anomalies)} unusual data points."]

    if critical > 0:
        parts.append(
            f"{critical} are marked as critical and require immediate attention."
        )

    if spikes > 0 and dips > 0:
        parts.append(f"There are {spikes} unexpected spikes and {dips} unusual dips.")
    elif spikes > 0:
        parts.append(f"There are {spikes} unexpected spikes in the data.")
    elif dips > 0:
        parts.append(f"There are {dips} unusual dips in the data.")

    # Add info about the most significant anomaly
    top_anomaly = anomalies[0]
    parts.append(
        f"The most notable event occurred on {top_anomaly['date']} "
        f"with a value of {top_anomaly['value']:,.0f} "
        f"({top_anomaly['deviation_pct']:+.1f}% from expected)."
    )
    parts.append(
        "We recommend investigating the root cause of critical anomalies."
    )

    return " ".join(parts)


def _template_scenario_explanation(result: Dict) -> str:
    """Generate a template-based scenario explanation (fallback)."""
    comparison = result.get("comparison", {})
    baseline_total = comparison.get("baseline_total", 0)
    scenarios = comparison.get("scenarios", [])

    if not scenarios:
        return "No scenario comparisons available."

    parts = [f"Baseline forecast total: {baseline_total:,.0f}."]

    for s in scenarios:
        diff_pct = s.get("difference_pct", 0)
        direction = "higher" if diff_pct > 0 else "lower"
        parts.append(
            f"Under the '{s['name']}' scenario, the forecast is "
            f"{abs(diff_pct):.1f}% {direction} at {s['total_forecast']:,.0f}."
        )

    return " ".join(parts)
