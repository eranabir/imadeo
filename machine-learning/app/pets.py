"""
Pet detection and identity embeddings.

Two separate jobs, because no single off-the-shelf model does both:

* *Detection* — find the cats and dogs in a picture. A general COCO object
  detector already knows both classes, so nothing needs training.
* *Identity* — decide which of them is Rex and which is Bella. There is no
  widely available pet equivalent of a face-recognition model, so the crop is
  embedded with CLIP and matched on appearance.

That second step is the honest weak point. Faces are matched on geometry that
stays put across photos; pets are matched on how they look, so two black
labradors will often land in the same group and one dog in shade versus sun may
land in two. The grouping is a starting point a person then corrects with the
same merge and detach tools the faces use.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from PIL import Image

log = logging.getLogger("imadeo.ml.pets")

# COCO class names the detector reports for the animals worth grouping. Kept
# narrow on purpose: horses and cows are livestock rather than pets, and adding
# "bird" or "teddy bear" produces more noise than it is worth.
PET_CLASSES = {"cat", "dog"}


@dataclass(slots=True)
class DetectedPet:
    bbox: np.ndarray
    score: float
    label: str
    embedding: np.ndarray


class PetEngine:
    """
    YOLO for "there is a dog, here" plus CLIP for "this dog looks like that one".

    Both models are downloaded on first use into the same /cache volume the face
    models use, so a rebuild does not re-fetch several hundred megabytes.
    """

    def __init__(
        self,
        detector_name: str = "yolov8n.pt",
        clip_name: str = "ViT-B-32",
        clip_weights: str = "openai",
        min_score: float = 0.4,
    ):
        self.detector_name = detector_name
        self.clip_name = clip_name
        self.clip_weights = clip_weights
        self.min_score = min_score
        self._detector = None
        self._clip = None
        self._preprocess = None

    @property
    def is_loaded(self) -> bool:
        return self._detector is not None and self._clip is not None

    def load(self) -> None:
        # Imported here rather than at module scope so the service still starts
        # and serves faces when the heavier pet dependencies are absent.
        from ultralytics import YOLO
        import open_clip
        import torch

        log.info("loading pet detector %s", self.detector_name)
        self._detector = YOLO(self.detector_name)

        log.info("loading %s/%s for pet identity", self.clip_name, self.clip_weights)
        model, _, preprocess = open_clip.create_model_and_transforms(
            self.clip_name, pretrained=self.clip_weights
        )
        model.eval()
        self._clip = model
        self._preprocess = preprocess
        self._torch = torch

    def detect(self, image: Image.Image) -> list[DetectedPet]:
        if not self.is_loaded:
            raise RuntimeError("The pet models are not loaded")

        results = self._detector.predict(
            image, verbose=False, conf=self.min_score, classes=None
        )

        found: list[DetectedPet] = []
        for result in results:
            names = result.names
            for box in result.boxes:
                label = names[int(box.cls)]
                if label not in PET_CLASSES:
                    continue

                x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
                # A sliver of an animal at the edge of a frame carries almost no
                # identity information and mostly produces spurious groups.
                if (x2 - x1) < 48 or (y2 - y1) < 48:
                    continue

                crop = image.crop((x1, y1, x2, y2))
                found.append(
                    DetectedPet(
                        bbox=np.array([x1, y1, x2, y2], dtype=np.float32),
                        score=float(box.conf),
                        label=label,
                        embedding=self._embed(crop),
                    )
                )

        return found

    def _embed(self, crop: Image.Image) -> np.ndarray:
        """A 512-d unit vector, matching the width the database columns expect."""
        tensor = self._preprocess(crop).unsqueeze(0)
        with self._torch.no_grad():
            features = self._clip.encode_image(tensor)

        vector = features[0].cpu().numpy().astype(np.float32)
        # Normalised so cosine distance is a plain dot product, the same
        # convention the face embeddings follow.
        norm = np.linalg.norm(vector)
        return vector / norm if norm > 0 else vector
