"""
Multi-model forecasting comparison.

Runs ETS, ARIMA(1,1,1) and Moving Average on the same series,
compares their accuracy on a hold-out set, and returns a ranked
leaderboard so users can see which model performs best.
"""

import numpy as np
import pandas as pd
import warnings
from typing import Dict, List
from .forecaster import generate_forecast, fit_ets_model

warnings.filterwarnings("ignore")


def compare_models(
    series: pd.Series,
    horizon: int = 4,
    confidence: float = 0.95,
    holdout_size: int = None,
) -> Dict:
    """
    Run multiple forecasting models and compare their accuracy.

    Uses a small hold-out set to evaluate each model, then generates
    full forecasts from all data. Returns a leaderboard ranked by MAPE.

    Args:
        series: Historical time series values.
        horizon: Forecast horizon (periods).
        confidence: Confidence level for prediction intervals.
        holdout_size: Hold-out periods for evaluation (default: min(4, n//5)).

    Returns:
        Dictionary with each model's forecast, accuracy metrics, and winner.
    """
    n = len(series)
    if holdout_size is None:
        holdout_size = max(2, min(4, n // 5))

    # Split for evaluation
    if n > holdout_size * 2:
        train = series.iloc[:-holdout_size]
        holdout = series.iloc[-holdout_size:].values
    else:
        train = series
        holdout = None

    models = {}

    # ── Model 1: ETS (Exponential Smoothing) ──────────────────────
    try:
        ets_full = generate_forecast(series, horizon=horizon, confidence=confidence)
        eval_mape = _eval_mape(train, holdout, horizon, holdout_size, "ets")
        models["ETS"] = {
            "name": "Exponential Smoothing (ETS)",
            "forecast": ets_full["forecast"],
            "lower_bound": ets_full["lower_bound"],
            "upper_bound": ets_full["upper_bound"],
            "mape": eval_mape if eval_mape is not None else ets_full["model_summary"]["mape"],
            "rmse": ets_full["model_summary"]["rmse"],
            "description": "Adapts exponentially to trend & seasonality; sensitive to recent spikes",
        }
    except Exception:
        pass

    # ── Model 2: ARIMA(1,1,1) ─────────────────────────────────────
    try:
        arima_result = _fit_arima_forecast(series, horizon, confidence)
        if arima_result:
            eval_mape = _eval_mape(train, holdout, horizon, holdout_size, "arima")
            models["ARIMA"] = {
                "name": "ARIMA(1,1,1)",
                "forecast": arima_result["forecast"],
                "lower_bound": arima_result["lower_bound"],
                "upper_bound": arima_result["upper_bound"],
                "mape": eval_mape if eval_mape is not None else arima_result["mape"],
                "rmse": arima_result["rmse"],
                "description": "Auto-differences to remove trend; robust to non-stationary series",
            }
    except Exception:
        pass

    # ── Model 3: Moving Average ────────────────────────────────────
    try:
        window = min(6, n // 3)
        ma_val = float(series.iloc[-window:].mean())
        std = float(series.std())
        z = 1.96 if confidence >= 0.95 else 1.645
        ma_mape = float(
            np.mean(np.abs((series - ma_val) / series.replace(0, np.nan))) * 100
        )
        models["Moving Average"] = {
            "name": f"Moving Average (window={window})",
            "forecast": [round(ma_val, 2)] * horizon,
            "lower_bound": [round(ma_val - z * std, 2)] * horizon,
            "upper_bound": [round(ma_val + z * std, 2)] * horizon,
            "mape": round(ma_mape, 2),
            "rmse": round(float(np.sqrt(np.mean((series - ma_val) ** 2))), 2),
            "description": "Stable baseline — smoothed mean of last N periods; low variance",
        }
    except Exception:
        pass

    if not models:
        raise ValueError("All models failed to fit")

    # ── Rank by MAPE ───────────────────────────────────────────────
    winner = min(models, key=lambda m: models[m]["mape"])
    ranked = sorted(models.items(), key=lambda x: x[1]["mape"])

    return {
        "models": models,
        "winner": winner,
        "winner_forecast": models[winner]["forecast"],
        "winner_lower": models[winner]["lower_bound"],
        "winner_upper": models[winner]["upper_bound"],
        "leaderboard": [
            {
                "rank": i + 1,
                "model": k,
                "name": v["name"],
                "mape": v["mape"],
                "rmse": v["rmse"],
                "description": v["description"],
                "is_winner": k == winner,
            }
            for i, (k, v) in enumerate(ranked)
        ],
        "model_count": len(models),
    }


def _fit_arima_forecast(
    series: pd.Series, horizon: int, confidence: float
) -> Dict:
    """Fit ARIMA(1,1,1) and return forecast with confidence intervals."""
    from statsmodels.tsa.arima.model import ARIMA

    model = ARIMA(series, order=(1, 1, 1))
    fit = model.fit()

    forecast_obj = fit.get_forecast(steps=horizon)
    mean_forecast = forecast_obj.predicted_mean
    alpha = 1 - confidence
    ci = forecast_obj.conf_int(alpha=alpha)

    fitted = fit.fittedvalues
    residuals = series - fitted
    mape = float(
        np.mean(np.abs(residuals / series.replace(0, np.nan)).dropna()) * 100
    )
    rmse = float(np.sqrt(np.mean(residuals ** 2)))

    return {
        "forecast": [round(float(v), 2) for v in mean_forecast],
        "lower_bound": [round(float(v), 2) for v in ci.iloc[:, 0]],
        "upper_bound": [round(float(v), 2) for v in ci.iloc[:, 1]],
        "mape": round(mape, 2),
        "rmse": round(rmse, 2),
    }


def _eval_mape(
    train: pd.Series,
    holdout: np.ndarray,
    horizon: int,
    holdout_size: int,
    model_type: str,
) -> float:
    """Evaluate MAPE on the hold-out set. Returns None if evaluation fails."""
    if holdout is None or len(holdout) == 0:
        return None
    try:
        if model_type == "ets":
            result = fit_ets_model(train)
            preds = np.array(result.forecast(holdout_size))
        elif model_type == "arima":
            from statsmodels.tsa.arima.model import ARIMA
            fit = ARIMA(train, order=(1, 1, 1)).fit()
            preds = fit.forecast(steps=holdout_size)
        else:
            return None

        actuals = np.array(holdout[:holdout_size])
        preds = preds[:holdout_size]
        with np.errstate(divide="ignore", invalid="ignore"):
            mape = np.nanmean(np.abs((actuals - preds) / actuals)) * 100
        return round(float(mape), 2) if np.isfinite(mape) else None
    except Exception:
        return None
