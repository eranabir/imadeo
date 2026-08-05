# The model weights are several hundred megabytes and are downloaded on first
# run into /cache, which is a volume — so the image stays small and a rebuild
# does not re-download them.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    INSIGHTFACE_HOME=/cache/insightface \
    # Both pet models download on first use; point them at the same volume the
    # face models use so a rebuild does not re-fetch them.
    YOLO_CONFIG_DIR=/cache/ultralytics \
    TORCH_HOME=/cache/torch \
    HF_HOME=/cache

WORKDIR /app

# InsightFace compiles a Cython extension at install time, so a compiler is
# needed here even though it is not needed at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      libglib2.0-0 \
      libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential \
    && apt-get autoremove -y

COPY app ./app

RUN mkdir -p /cache

EXPOSE 3003

# One worker: the model is large and each worker would load its own copy. The
# Node side already queues work, so concurrency is controlled there.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3003", "--workers", "1"]
