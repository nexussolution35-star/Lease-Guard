"""Write openapi.json so the backend can generate a typed client for this service.

Usage (from python-services/document-processing): .venv/bin/python scripts/export_openapi.py
"""

import json
from pathlib import Path

from app.main import app

OUTPUT = Path(__file__).resolve().parents[1] / "openapi.json"

if __name__ == "__main__":
    OUTPUT.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {OUTPUT}")
