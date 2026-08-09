"""YuNet detection and SFace embeddings from OpenCV Zoo."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np

from .model_store import ModelStore

log = logging.getLogger("imadeo.ml.faces")

YUNET_URL = "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx"
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
SFACE_URL = "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx"
SFACE_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"


@dataclass(slots=True)
class DetectedFace:
    bbox: np.ndarray
    score: float
    embedding: np.ndarray
    pose: np.ndarray | None = None


class FaceEngine:
    """
    Runs the MIT-licensed YuNet detector and Apache-2.0 SFace recognizer.

    SFace produces 128-dimensional vectors. They are zero-padded to 512 values
    after L2 normalisation, preserving cosine distance while retaining the
    existing pgvector column and server API shape.
    """

    model_name = "yunet+sface"

    def __init__(self, min_score: float = 0.7):
        self.min_score = min_score
        self._detector: cv2.FaceDetectorYN | None = None
        self._recognizer: cv2.FaceRecognizerSF | None = None

    @property
    def is_loaded(self) -> bool:
        return self._detector is not None and self._recognizer is not None

    def load(self) -> None:
        store = ModelStore()
        detector_path = store.fetch("face_detection_yunet_2023mar.onnx", YUNET_URL, YUNET_SHA256)
        recognizer_path = store.fetch("face_recognition_sface_2021dec.onnx", SFACE_URL, SFACE_SHA256)

        log.info("loading %s", self.model_name)
        self._detector = cv2.FaceDetectorYN.create(
            str(detector_path), "", (320, 320), self.min_score, 0.3, 5000
        )
        self._recognizer = cv2.FaceRecognizerSF.create(str(recognizer_path), "")

    def detect(self, payload: bytes) -> tuple[list[DetectedFace], int, int]:
        if not self.is_loaded:
            raise RuntimeError("The model is not loaded")

        buffer = np.frombuffer(payload, dtype=np.uint8)
        image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Could not decode that image")

        height, width = image.shape[:2]
        self._detector.setInputSize((width, height))
        _, detections = self._detector.detect(image)
        if detections is None:
            return [], width, height

        results: list[DetectedFace] = []
        for detection in detections:
            x, y, box_width, box_height = (float(value) for value in detection[:4])
            score = float(detection[-1])
            if score < self.min_score or box_width < 16 or box_height < 16:
                continue

            # FaceRecognizerSF uses YuNet's 15-value detection row, including
            # its five landmarks, to align the crop before encoding it.
            feature = self._recognizer.feature(self._recognizer.alignCrop(image, detection))
            embedding = self._to_storage_embedding(feature.ravel())
            if embedding is None:
                log.warning("discarding a face with an unusable embedding")
                continue

            results.append(
                DetectedFace(
                    bbox=np.array(
                        [max(0, x), max(0, y), min(width, x + box_width), min(height, y + box_height)],
                        dtype=np.float32,
                    ),
                    score=score,
                    embedding=embedding,
                )
            )

        results.sort(key=lambda face: (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1]), reverse=True)
        return results, width, height

    @staticmethod
    def _to_storage_embedding(feature: np.ndarray) -> np.ndarray | None:
        vector = np.asarray(feature, dtype=np.float32)
        if vector.shape != (128,) or not np.isfinite(vector).all():
            return None
        norm = np.linalg.norm(vector)
        if norm == 0:
            return None
        return np.pad(vector / norm, (0, 384))
