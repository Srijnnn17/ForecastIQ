"""
Anomaly detection API routes.

Endpoints for detecting unusual spikes and dips in time series data,
with severity scoring and AI-generated explanations.
"""

import os
from flask import Blueprint, request, jsonify
from ..utils.data_loader import load_csv, prepare_time_series
from ..utils.validators import validate_anomaly_params
from ..services.anomaly_detector import detect_anomalies
from ..services.explainer import explain_anomalies
from ..models.schemas import success_response, error_response
from ..config import Config

anomaly_bp = Blueprint("anomaly", __name__)


@anomaly_bp.route("/api/anomalies", methods=["POST"])
def detect():
    """
    Detect anomalies in a dataset.

    Request body (JSON):
        - dataset: str — CSV filename
        - value_column: str (optional) — column to analyze
        - sensitivity: int (optional, 1-5, default 3) — detection sensitivity

    Returns list of anomalies with severity, direction, and context.
    """
    try:
        params = request.get_json(force=True)
        validated = validate_anomaly_params(params)
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

        # Detect anomalies
        result = detect_anomalies(
            series=series,
            dates=dates,
            sensitivity=validated["sensitivity"],
        )

        # Generate AI explanation
        language = params.get("language", "English")
        explanation = explain_anomalies(result, language)

        response_data = {
            "historical": {
                "dates": dates.dt.strftime("%Y-%m-%d").tolist(),
                "values": series.tolist(),
            },
            "anomalies": result["anomalies"],
            "total_anomalies": result["total_anomalies"],
            "summary": result["summary"],
            "explanation": explanation,
            "dataset_info": {
                "name": dataset_name,
                "column": value_col,
                "total_points": len(series),
            },
        }

        return jsonify(success_response(
            data=response_data,
            message=f"Found {result['total_anomalies']} anomalies",
        ))

    except FileNotFoundError:
        return jsonify(error_response(
            message=f"Dataset '{validated.get('dataset')}' not found",
            error_code="DATASET_NOT_FOUND",
        )), 404
    except Exception as e:
        return jsonify(error_response(
            message=str(e),
            error_code="ANOMALY_ERROR",
        )), 500


def _resolve_path(filename: str) -> str:
    """Resolve dataset filename to full path."""
    for directory in [Config.DATA_DIR, Config.UPLOAD_DIR]:
        path = os.path.join(directory, filename)
        if os.path.exists(path):
            return path
    raise FileNotFoundError(f"Dataset '{filename}' not found")
