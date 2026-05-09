"""
Configuration module for the Flask application.

Loads environment variables and provides centralized configuration
for all application components.
"""

import os
from dotenv import load_dotenv

# Resolve .env relative to this file (src/backend/config.py → ../../.env)
_ENV_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", ".env")
)
load_dotenv(_ENV_PATH, override=True)


class Config:
    """Application configuration loaded from environment variables."""

    # Flask settings
    FLASK_ENV = os.getenv("FLASK_ENV", "development")
    DEBUG = os.getenv("FLASK_DEBUG", "1") == "1"
    PORT = int(os.getenv("FLASK_PORT", 5000))

    # CORS
    CORS_ORIGINS = os.getenv(
        "CORS_ORIGINS", "http://localhost:5000,http://127.0.0.1:5000"
    ).split(",")

    # Data directories
    BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    DATA_DIR = os.path.join(BASE_DIR, os.getenv("DATA_DIR", "data"))
    UPLOAD_DIR = os.path.join(BASE_DIR, os.getenv("UPLOAD_DIR", "uploads"))
    MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", 10))

    # AI Configuration
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

    # Forecasting defaults
    DEFAULT_FORECAST_HORIZON = 4  # periods
    MAX_FORECAST_HORIZON = 12
    CONFIDENCE_LEVEL = 0.95  # 95% confidence intervals

    @classmethod
    def validate(cls):
        """Validate that required configuration is present."""
        os.makedirs(cls.DATA_DIR, exist_ok=True)
        os.makedirs(cls.UPLOAD_DIR, exist_ok=True)

        if not cls.GEMINI_API_KEY:
            print(
                "WARNING: GEMINI_API_KEY not set. "
                "AI explanations will use fallback mode.\n"
                f"  .env loaded from: {_ENV_PATH}\n"
                f"  File exists: {os.path.exists(_ENV_PATH)}"
            )
        else:
            key = cls.GEMINI_API_KEY
            print(f"✓ GEMINI_API_KEY loaded: {key[:8]}…{key[-4:]}")
