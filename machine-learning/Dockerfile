# Model weights are downloaded on first run into /cache, which is a volume — so
# the image stays small and a rebuild does not re-download them.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ML_MODEL_CACHE=/cache/imadeo-models \
    TORCH_HOME=/cache/torch \
    HF_HOME=/cache

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      libglib2.0-0 \
      libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /cache

EXPOSE 3003

# One worker: the model is large and each worker would load its own copy. The
# app serializes inference without blocking this worker's HTTP event loop.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3003", "--workers", "1", "--timeout-keep-alive", "30"]
