"""
Forecasting API routes.

Endpoints for generating short-term forecasts with prediction intervals,
decomposition into trend/seasonal components, and baseline comparison.
"""

import os
from flask import Blueprint, request, jsonify
from ..utils.data_loader import load_csv, prepare_time_series
from ..utils.validators import validate_forecast_params
from ..services.forecaster import generate_forecast
from ..services.baseline import compare_with_baseline
from ..services.explainer import explain_forecast
from ..models.schemas import success_response, error_response
from ..config import Config
import pandas as pd

forecast_bp = Blueprint("forecast", __name__)


@forecast_bp.route("/api/forecast", methods=["POST"])
def create_forecast():
    """
    Generate a short-term forecast.

    Request body (JSON):
        - dataset: str — CSV filename to use
        - value_column: str (optional) — column to forecast
        - horizon: int (optional, default 4) — periods to forecast
        - confidence: float (optional, default 0.95) — confidence level

    Returns forecast values with confidence intervals,
    decomposition, baseline comparison, and AI explanation.
    """
    try:
        params = request.get_json(force=True)
        validated = validate_forecast_params(params)
    except ValueError as e:
        return jsonify(error_response(
            message=str(e),
            error_code="VALIDATION_ERROR",
        )), 400

    try:
        # Load and prepare data
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

        # Generate forecast
        horizon = validated["horizon"]
        confidence = validated["confidence"]
        forecast_result = generate_forecast(
            series, horizon=horizon, confidence=confidence
        )

        # Generate forecast dates
        last_date = pd.to_datetime(dates.iloc[-1])
        freq = _infer_frequency(dates)
        forecast_dates = pd.date_range(
            start=last_date + pd.tseries.frequencies.to_offset(freq),
            periods=horizon,
            freq=freq,
        )

        # Baseline comparison
        baseline_result = compare_with_baseline(
            series, forecast_result["forecast"]
        )

        # AI explanation
        language = params.get("language", "English")
        explanation = explain_forecast(forecast_result, horizon, language)

        response_data = {
            "historical": {
                "dates": dates.dt.strftime("%Y-%m-%d").tolist(),
                "values": series.tolist(),
                "fitted": forecast_result["fitted_values"],
            },
            "forecast": {
                "dates": forecast_dates.strftime("%Y-%m-%d").tolist(),
                "values": forecast_result["forecast"],
                "lower_bound": forecast_result["lower_bound"],
                "upper_bound": forecast_result["upper_bound"],
            },
            "decomposition": forecast_result["decomposition"],
            "model_summary": forecast_result["model_summary"],
            "baseline_comparison": baseline_result,
            "explanation": explanation,
            "dataset_info": {
                "name": dataset_name,
                "column": value_col,
                "total_points": len(series),
            },
        }

        return jsonify(success_response(
            data=response_data,
            message="Forecast generated successfully",
        ))

    except FileNotFoundError:
        return jsonify(error_response(
            message=f"Dataset '{validated.get('dataset')}' not found",
            error_code="DATASET_NOT_FOUND",
        )), 404
    except Exception as e:
        return jsonify(error_response(
            message=str(e),
            error_code="FORECAST_ERROR",
        )), 500


def _resolve_path(filename: str) -> str:
    """Resolve dataset filename to full path."""
    for directory in [Config.DATA_DIR, Config.UPLOAD_DIR]:
        path = os.path.join(directory, filename)
        if os.path.exists(path):
            return path
    raise FileNotFoundError(f"Dataset '{filename}' not found")


def _infer_frequency(dates: pd.Series) -> str:
    """
    Infer the frequency of a date series.

    Args:
        dates: Series of datetime values.

    Returns:
        pandas frequency string (e.g. 'W', 'D', 'MS').
    """
    if len(dates) < 2:
        return "D"

    diff = (dates.iloc[-1] - dates.iloc[-2]).days

    if diff <= 1:
        return "D"
    elif diff <= 7:
        return "W"
    elif diff <= 15:
        return "2W"
    elif diff <= 31:
        return "MS"
    elif diff <= 92:
        return "QS"
    else:
        return "YS"
