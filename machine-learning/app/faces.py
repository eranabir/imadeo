"""InsightFace wrapper: detection plus recognition embeddings."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np
from insightface.app import FaceAnalysis

log = logging.getLogger("imadeo.ml.faces")


@dataclass(slots=True)
class DetectedFace:
    bbox: np.ndarray
    score: float
    embedding: np.ndarray
    pose: np.ndarray | None


class FaceEngine:
    """
    Loads a buffalo model set and runs detection + recognition over an image.

    `buffalo_l` bundles a RetinaFace detector and a ResNet-50 recognition model
    producing 512-d embeddings — the same width the database's `vector(512)`
    columns expect.
    """

    def __init__(self, model_name: str = "buffalo_l", min_score: float = 0.7, det_size: int = 640):
        self.model_name = model_name
        self.min_score = min_score
        self.det_size = det_size
        self._app: FaceAnalysis | None = None

    @property
    def is_loaded(self) -> bool:
        return self._app is not None

    def load(self) -> None:
        log.info("loading %s (detection size %d)", self.model_name, self.det_size)
        app = FaceAnalysis(
            name=self.model_name,
            # Only the pieces that are actually used. Skipping the age/gender and
            # landmark extras roughly halves both load time and memory.
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=0, det_size=(self.det_size, self.det_size))
        self._app = app

    def detect(self, payload: bytes) -> tuple[list[DetectedFace], int, int]:
        if self._app is None:
            raise RuntimeError("The model is not loaded")

        buffer = np.frombuffer(payload, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Could not decode that image")

        height, width = image.shape[:2]

        results = []
        for face in self._app.get(image):
            score = float(face.det_score)
            if score < self.min_score:
                continue

            embedding = np.asarray(face.normed_embedding, dtype=np.float32)

            # A degenerate embedding would poison clustering, so drop it.
            if embedding.shape[0] != 512 or not np.isfinite(embedding).all():
                log.warning("discarding a face with an unusable embedding")
                continue

            results.append(
                DetectedFace(
                    bbox=np.clip(
                        face.bbox,
                        [0, 0, 0, 0],
                        [width, height, width, height],
                    ),
                    score=score,
                    embedding=embedding,
                    pose=getattr(face, "pose", None),
                )
            )

        # Largest first: the most prominent face makes the better thumbnail.
        results.sort(key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)
        return results, width, height
