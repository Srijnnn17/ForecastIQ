"""
Scenario comparison API routes.

Endpoints for generating and comparing "what-if" scenario forecasts
with adjustable parameters like growth rate, outlier removal, and patterns.
"""

import os
from flask import Blueprint, request, jsonify
from ..utils.data_loader import load_csv, prepare_time_series
from ..utils.validators import validate_scenario_params
from ..services.scenario_engine import compare_scenarios
from ..services.explainer import explain_scenario_comparison
from ..models.schemas import success_response, error_response
from ..config import Config
import pandas as pd

scenario_bp = Blueprint("scenario", __name__)


@scenario_bp.route("/api/scenarios", methods=["POST"])
def compare():
    """
    Compare multiple forecast scenarios.

    Request body (JSON):
        - dataset: str — CSV filename
        - value_column: str (optional) — column to forecast
        - horizon: int (optional, default 4) — periods to forecast
        - confidence: float (optional, default 0.95)
        - growth_adjustment: float (optional) — percentage growth change
        - remove_outliers: bool (optional) — whether to clean outliers
        - pattern: str (optional) — 'trend', 'flat', or 'seasonal'

    Returns baseline and scenario forecasts with comparison summary.
    """
    try:
        params = request.get_json(force=True)
        validated = validate_scenario_params(params)
    except ValueError as e:
        return jsonify(error_response(
            message=str(e),
            error_code="VALIDATION_ERROR",
        )), 400

    try:
        dataset_name = validated["dataset"]
        if not dataset_name:
            return jsonify(error_response(
                message="Dataset name is required",
                error_code="MISSING_DATASET",
            )), 400

        filepath = _resolve_path(dataset_name)
        df = load_csv(filepath)
        df, date_col, value_col = prepare_time_series(
            df, value_col=validated.get("value_column")
        )

        series = df[value_col]
        dates = df[date_col]

        # Build scenario list from parameters
        scenarios = [
            {
                "name": "Baseline",
                "growth_adjustment": 0,
                "remove_outliers": False,
                "pattern": "trend",
            },
            {
                "name": _describe_scenario(validated),
                "growth_adjustment": validated["growth_adjustment"],
                "remove_outliers": validated["remove_outliers"],
                "pattern": validated["pattern"],
            },
        ]

        # Generate comparisons
        result = compare_scenarios(
            series=series,
            dates=dates,
            horizon=validated["horizon"],
            confidence=validated["confidence"],
            scenarios=scenarios,
        )

        # Generate forecast dates
        last_date = pd.to_datetime(dates.iloc[-1])
        freq = _infer_frequency(dates)
        forecast_dates = pd.date_range(
            start=last_date + pd.tseries.frequencies.to_offset(freq),
            periods=validated["horizon"],
            freq=freq,
        )

        result["forecast_dates"] = forecast_dates.strftime("%Y-%m-%d").tolist()
        result["historical_dates"] = dates.dt.strftime("%Y-%m-%d").tolist()

        # AI explanation
        language = params.get("language", "English")
        explanation = explain_scenario_comparison(result, language)
        result["explanation"] = explanation

        result["dataset_info"] = {
            "name": dataset_name,
            "column": value_col,
            "total_points": len(series),
        }

        return jsonify(success_response(
            data=result,
            message="Scenario comparison completed",
        ))

    except FileNotFoundError:
        return jsonify(error_response(
            message=f"Dataset '{validated.get('dataset')}' not found",
            error_code="DATASET_NOT_FOUND",
        )), 404
    except Exception as e:
        return jsonify(error_response(
            message=str(e),
            error_code="SCENARIO_ERROR",
        )), 500


def _describe_scenario(params: dict) -> str:
    """Generate a human-readable scenario name from parameters."""
    parts = []
    growth = params.get("growth_adjustment", 0)
    if growth != 0:
        parts.append(f"{growth * 100:+.0f}% Growth")
    if params.get("remove_outliers"):
        parts.append("Outliers Removed")
    pattern = params.get("pattern", "trend")
    if pattern != "trend":
        parts.append(f"{pattern.title()} Pattern")
    return " + ".join(parts) if parts else "Custom Scenario"


def _resolve_path(filename: str) -> str:
    """Resolve dataset filename to full path."""
    for directory in [Config.DATA_DIR, Config.UPLOAD_DIR]:
        path = os.path.join(directory, filename)
        if os.path.exists(path):
            return path
    raise FileNotFoundError(f"Dataset '{filename}' not found")


def _infer_frequency(dates: pd.Series) -> str:
    """Infer the frequency of a date series."""
    if len(dates) < 2:
        return "D"
    diff = (dates.iloc[-1] - dates.iloc[-2]).days
    if diff <= 1:
        return "D"
    elif diff <= 7:
        return "W"
    elif diff <= 31:
        return "MS"
    elif diff <= 92:
        return "QS"
    return "YS"
