# DEPENDENCIES
# Consumed by: docker-compose.yml, docs/DEPLOYMENT.md
# Consumes: requirements.txt, main.py
# Risk-sensitive: NO
# Last modified: 2026-03-09
# Notes: Optional Phase 13 model-service scaffold for local deployment only.

FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]