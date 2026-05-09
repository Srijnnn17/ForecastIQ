"""
Flask application entry point.

Sets up the Flask app with CORS, registers API blueprints,
and serves the frontend static files.
"""

import os
import sys

# Add project root to path for imports
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, project_root)

from flask import Flask, send_from_directory
from flask_cors import CORS
from src.backend.config import Config
from src.backend.routes.forecast import forecast_bp
from src.backend.routes.anomaly import anomaly_bp
from src.backend.routes.scenario import scenario_bp
from src.backend.routes.dataset import dataset_bp
from src.backend.routes.extras import extras_bp
from src.backend.routes.news_agents import news_agents_bp
from src.backend.services.explainer import configure_gemini


def create_app() -> Flask:
    """
    Create and configure the Flask application.

    Returns:
        Configured Flask application instance.
    """
    # Resolve paths for static files
    frontend_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "frontend")
    )

    app = Flask(
        __name__,
        static_folder=frontend_dir,
        static_url_path="",
    )

    # Configuration
    Config.validate()
    app.config["MAX_CONTENT_LENGTH"] = Config.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    # CORS
    CORS(app, origins=Config.CORS_ORIGINS)

    # Configure AI services
    configure_gemini()

    # Register API blueprints
    app.register_blueprint(forecast_bp)
    app.register_blueprint(anomaly_bp)
    app.register_blueprint(scenario_bp)
    app.register_blueprint(dataset_bp)
    app.register_blueprint(extras_bp)
    app.register_blueprint(news_agents_bp)

    # Serve frontend
    @app.route("/")
    def serve_frontend():
        """Serve the main frontend page."""
        return send_from_directory(frontend_dir, "index.html")

    @app.route("/health")
    def health_check():
        """Health check endpoint for monitoring."""
        return {"status": "healthy", "version": "1.0.0"}

    return app


if __name__ == "__main__":
    app = create_app()
    print(f"Starting ForecastIQ on http://localhost:{Config.PORT}")
    print(f"Frontend: http://localhost:{Config.PORT}/")
    print(f"API docs: http://localhost:{Config.PORT}/health")
    app.run(
        host="0.0.0.0",
        port=Config.PORT,
        debug=Config.DEBUG,
    )
