"""
DEPENDENCIES
Consumed by: docker-compose.yml, docs/DEPLOYMENT.md
Consumes: FastAPI runtime only
Risk-sensitive: NO
Last modified: 2026-03-09
Notes: Optional model-service scaffold used for deployment smoke tests.
"""

from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel


class CandidateRequest(BaseModel):
    symbol: str
    base_score: float
    regime: str | None = None


app = FastAPI(title="HybridTurtle Model Service", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/versions")
def versions() -> dict[str, object]:
    return {
        "service": "hybridturtle-model-service",
        "version": "0.1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/predict/candidate")
def predict_candidate(payload: CandidateRequest) -> dict[str, object]:
    adjusted = min(100.0, max(0.0, payload.base_score + 2.5))
    return {
        "symbol": payload.symbol,
        "baseScore": payload.base_score,
        "modelScore": adjusted,
        "confidence": 55.0,
        "uncertainty": 45.0,
        "recommendation": "NEUTRAL",
        "regime": payload.regime,
    }