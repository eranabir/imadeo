"""
CLIP embeddings, for searching photos by what is in them.

Pictures and phrases are encoded into the *same* 512-dimension space, so "sunrise
on the beach" can be compared directly against every photo by cosine distance —
no captions, no tagging, and no list of allowed words.

Kept separate from the pet engine even though both use CLIP: search should keep
working on a server that has pet recognition switched off, and vice versa.
"""

from __future__ import annotations

import logging

import numpy as np
from PIL import Image

log = logging.getLogger("imadeo.ml.clip")


class ClipEngine:
    def __init__(self, model_name: str = "ViT-B-32", weights: str = "openai"):
        self.model_name = model_name
        self.weights = weights
        self._model = None
        self._preprocess = None
        self._tokenizer = None
        self._torch = None

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        import open_clip
        import torch

        log.info("loading %s/%s for search", self.model_name, self.weights)
        model, _, preprocess = open_clip.create_model_and_transforms(
            self.model_name, pretrained=self.weights
        )
        model.eval()
        self._model = model
        self._preprocess = preprocess
        self._tokenizer = open_clip.get_tokenizer(self.model_name)
        self._torch = torch

    def _normalise(self, vector: np.ndarray) -> np.ndarray:
        # Unit length, so cosine distance is a plain dot product — the same
        # convention the face and pet embeddings follow.
        norm = np.linalg.norm(vector)
        return vector / norm if norm > 0 else vector

    def encode_image(self, image: Image.Image) -> np.ndarray:
        if not self.is_loaded:
            raise RuntimeError("The search model is not loaded")

        tensor = self._preprocess(image).unsqueeze(0)
        with self._torch.no_grad():
            features = self._model.encode_image(tensor)
        return self._normalise(features[0].cpu().numpy().astype(np.float32))

    def encode_text(self, text: str) -> np.ndarray:
        if not self.is_loaded:
            raise RuntimeError("The search model is not loaded")

        tokens = self._tokenizer([text])
        with self._torch.no_grad():
            features = self._model.encode_text(tokens)
        return self._normalise(features[0].cpu().numpy().astype(np.float32))
