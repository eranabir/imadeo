"""
Imadeo machine-learning service.

A deliberately small HTTP surface in front of local, permissively licensed
models. Face detection and recognition are the only things Python is doing
here: the Node server owns all the data, and this process holds no state beyond
the loaded model.

Kept as a separate service because the models are large, slow to load and
CPU-hungry. Running them in-process would make the API server's memory profile
unpredictable and a model reload would take the whole app down.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from PIL import Image

from .clip import ClipEngine
from .faces import FaceEngine
from .pets import PetEngine

logging.basicConfig(
    level=os.getenv("ML_LOG_LEVEL", "INFO"),
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
)
log = logging.getLogger("imadeo.ml")

engine: FaceEngine | None = None
pets: PetEngine | None = None
clip: ClipEngine | None = None

# OpenCV and PyTorch inference are synchronous and CPU-heavy. Running them
# directly inside an async route blocks Uvicorn's only event loop, including
# health checks and keep-alive handling. One shared lock also keeps the three
# models from fighting over every CPU core on small NAS installations.
inference_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Load the models once, at startup, rather than on the first request."""
    global engine, pets, clip
    engine = FaceEngine(
        min_score=float(os.getenv("ML_FACE_MIN_SCORE", "0.7")),
    )
    engine.load()
    log.info("face engine ready")

    # Pets are optional. They pull in a much heavier stack than the face models,
    # so a server that cannot or does not want to carry it keeps working — the
    # endpoint simply reports itself unavailable.
    if os.getenv("ML_PETS_ENABLED", "true").lower() in {"1", "true", "yes", "on"}:
        try:
            pets = PetEngine(min_score=float(os.getenv("ML_PET_MIN_SCORE", "0.4")))
            pets.load()
            log.info("pet engine ready")
        except Exception:
            log.exception("pet models unavailable; continuing with faces only")
            pets = None

    # Search embeddings. Independent of pets so either can be switched off.
    if os.getenv("ML_CLIP_ENABLED", "true").lower() in {"1", "true", "yes", "on"}:
        try:
            clip = ClipEngine(model_name=os.getenv("ML_CLIP_MODEL_NAME", "ViT-B-32"))
            clip.load()
            log.info("search engine ready")
        except Exception:
            log.exception("search model unavailable; continuing without it")
            clip = None

    yield
    engine = None
    pets = None
    clip = None


app = FastAPI(
    title="Imadeo machine learning",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok" if engine and engine.is_loaded else "loading",
        "faces": {
            "model": engine.model_name if engine else None,
            "loaded": bool(engine and engine.is_loaded),
        },
        "pets": {
            "model": pets.detector_name if pets else None,
            "loaded": bool(pets and pets.is_loaded),
        },
        "search": {
            "model": clip.model_name if clip else None,
            "loaded": bool(clip and clip.is_loaded),
        },
    }


@app.post("/predict/faces")
async def predict_faces(image: UploadFile = File(...)) -> JSONResponse:
    """
    Detects faces in one image.

    Returns a bounding box in the coordinate space of the image that was sent,
    plus a normalised 512-dimension embedding per face. SFace's native 128-d
    vector is zero-padded without changing cosine distance, so the existing
    server schema remains compatible.
    """
    if not engine or not engine.is_loaded:
        raise HTTPException(status_code=503, detail="The face model is still loading")

    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty image")

    try:
        async with inference_lock:
            faces, width, height = await run_in_threadpool(engine.detect, payload)
    except ValueError as error:
        # A file the decoder cannot read is a bad request, not a server fault.
        raise HTTPException(status_code=400, detail=str(error)) from error

    return JSONResponse(
        {
            "imageWidth": width,
            "imageHeight": height,
            "faces": [
                {
                    "boundingBox": {
                        "x1": int(face.bbox[0]),
                        "y1": int(face.bbox[1]),
                        "x2": int(face.bbox[2]),
                        "y2": int(face.bbox[3]),
                    },
                    "score": float(face.score),
                    "embedding": face.embedding.tolist(),
                    # Rough head pose, useful for picking the nicest thumbnail.
                    "yaw": float(face.pose[1]) if face.pose is not None else None,
                }
                for face in faces
            ],
        }
    )


@app.post("/predict/pets")
async def predict_pets(image: UploadFile = File(...)) -> JSONResponse:
    """
    Finds cats and dogs in one image.

    Same shape as the face endpoint — box, score, normalised 512-d embedding —
    so the caller can reuse one clustering path, plus the species it detected.
    """
    if not pets or not pets.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="Pet recognition is not available on this server",
        )

    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty image")

    try:
        picture = Image.open(io.BytesIO(payload)).convert("RGB")
    except Exception as error:
        raise HTTPException(status_code=400, detail="Unreadable image") from error

    async with inference_lock:
        found = await run_in_threadpool(pets.detect, picture)

    return JSONResponse(
        {
            "imageWidth": picture.width,
            "imageHeight": picture.height,
            "pets": [
                {
                    "boundingBox": {
                        "x1": int(pet.bbox[0]),
                        "y1": int(pet.bbox[1]),
                        "x2": int(pet.bbox[2]),
                        "y2": int(pet.bbox[3]),
                    },
                    "score": float(pet.score),
                    "label": pet.label,
                    "embedding": pet.embedding.tolist(),
                }
                for pet in found
            ],
        }
    )


@app.post("/predict/pets/candidate")
async def classify_pet_face_candidate(
    image: UploadFile = File(...),
    x1: int = Form(...),
    y1: int = Form(...),
    x2: int = Form(...),
    y2: int = Form(...),
) -> JSONResponse:
    """Classify one face-sized crop when whole-animal detection found nothing."""
    if not pets or not pets.is_loaded:
        raise HTTPException(status_code=503, detail="Pet recognition is not available on this server")

    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty image")

    try:
        picture = Image.open(io.BytesIO(payload)).convert("RGB")
    except Exception as error:
        raise HTTPException(status_code=400, detail="Unreadable image") from error

    width, height = picture.size
    left, top = max(0, x1), max(0, y1)
    right, bottom = min(width, x2), min(height, y2)
    if right <= left or bottom <= top:
        raise HTTPException(status_code=400, detail="Invalid candidate bounds")

    async with inference_lock:
        candidate = await run_in_threadpool(
            pets.classify_face_candidate,
            picture.crop((left, top, right, bottom)),
        )
    if not candidate:
        return JSONResponse({"pet": None})

    return JSONResponse(
        {
            "pet": {
                "label": candidate.label,
                "score": float(candidate.score),
                "embedding": candidate.embedding.tolist(),
            }
        }
    )


@app.post("/encode/image")
async def encode_image(image: UploadFile = File(...)) -> JSONResponse:
    """A 512-d embedding describing what is in one picture."""
    if not clip or not clip.is_loaded:
        raise HTTPException(status_code=503, detail="Search encoding is not available")

    payload = await image.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty image")

    try:
        picture = Image.open(io.BytesIO(payload)).convert("RGB")
    except Exception as error:
        raise HTTPException(status_code=400, detail="Unreadable image") from error

    async with inference_lock:
        embedding = await run_in_threadpool(clip.encode_image, picture)

    return JSONResponse({"embedding": embedding.tolist()})


@app.post("/encode/text")
async def encode_text(payload: dict[str, str]) -> JSONResponse:
    """The same space as /encode/image, so a phrase can be compared to photos."""
    if not clip or not clip.is_loaded:
        raise HTTPException(status_code=503, detail="Search encoding is not available")

    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Empty text")

    async with inference_lock:
        embedding = await run_in_threadpool(clip.encode_text, text)

    return JSONResponse({"embedding": embedding.tolist()})


@app.post("/predict/faces/compare")
async def compare(payload: dict[str, list[float]]) -> dict[str, float]:
    """Cosine distance between two embeddings. Exposed for debugging."""
    a = np.asarray(payload["a"], dtype=np.float32)
    b = np.asarray(payload["b"], dtype=np.float32)
    return {"distance": float(1.0 - np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))}
