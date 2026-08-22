"""NanoDet pet detection and CLIP identity embeddings."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image

from .model_store import ModelStore

log = logging.getLogger("imadeo.ml.pets")

NANODET_URL = "https://huggingface.co/opencv/object_detection_nanodet/resolve/main/object_detection_nanodet_2022nov.onnx"
NANODET_SHA256 = "4b82da9944b88577175ee23a459dce2e26e6e4be573def65b1055dc2d9720186"
NANODET_SIZE = 416
NANODET_STRIDES = (8, 16, 32)
NANODET_REG_MAX = 7
COCO_CLASSES = (
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
    "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
    "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard",
    "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors",
    "teddy bear", "hair drier", "toothbrush",
)
PET_CLASS_IDS = {COCO_CLASSES.index("cat"): "cat", COCO_CLASSES.index("dog"): "dog"}


@dataclass(slots=True)
class DetectedPet:
    bbox: np.ndarray
    score: float
    label: str
    embedding: np.ndarray


class PetEngine:
    """Apache-2.0 NanoDet finds cats and dogs; CLIP groups their crops."""

    detector_name = "nanodet-coco"

    def __init__(self, min_score: float = 0.4):
        self.min_score = min_score
        self._detector: cv2.dnn.Net | None = None
        self._clip = None
        self._preprocess = None
        self._tokenizer = None
        self._torch = None
        self._candidate_text_embeddings: dict[str, np.ndarray] = {}
        self._anchors = self._make_anchors()

    @property
    def is_loaded(self) -> bool:
        return self._detector is not None and self._clip is not None

    def load(self) -> None:
        import open_clip
        import torch

        model_path = ModelStore().fetch(
            "object_detection_nanodet_2022nov.onnx", NANODET_URL, NANODET_SHA256
        )
        log.info("loading pet detector %s", self.detector_name)
        self._detector = cv2.dnn.readNet(str(model_path))

        log.info("loading ViT-B-32/openai for pet identity")
        model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
        model.eval()
        self._clip = model
        self._preprocess = preprocess
        self._tokenizer = open_clip.get_tokenizer("ViT-B-32")
        self._torch = torch

        # NanoDet is good at finding a whole animal, but can miss a cat held
        # close to someone. YuNet then often finds the cat's face, so use CLIP
        # as a narrow second opinion for those face-sized candidate crops.
        for label, prompt in {
            "cat": "a photo of a cat",
            "dog": "a photo of a dog",
            "person": "a photo of a person",
            "vehicle": "a photo of a vehicle",
            "object": "a photo of an object",
            "landscape": "a photo of a landscape",
        }.items():
            tokens = self._tokenizer([prompt])
            with torch.no_grad():
                features = self._clip.encode_text(tokens)
            vector = features[0].cpu().numpy().astype(np.float32)
            self._candidate_text_embeddings[label] = vector / np.linalg.norm(vector)

    def detect(self, image: Image.Image) -> list[DetectedPet]:
        if not self.is_loaded:
            raise RuntimeError("The pet models are not loaded")

        original = np.asarray(image.convert("RGB"))
        letterboxed, scale = self._letterbox(original)
        normalised = (letterboxed.astype(np.float32) - np.array([103.53, 116.28, 123.675])) / np.array(
            [57.375, 57.12, 58.395]
        )
        self._detector.setInput(cv2.dnn.blobFromImage(normalised))
        detections = self._postprocess(self._detector.forward(self._detector.getUnconnectedOutLayersNames()))

        found: list[DetectedPet] = []
        for x1, y1, x2, y2, score, class_id in detections:
            label = PET_CLASS_IDS.get(int(class_id))
            if not label:
                continue

            bbox = self._unletterbox(np.array([x1, y1, x2, y2], dtype=np.float32), original.shape[:2], scale)
            if bbox[2] - bbox[0] < 48 or bbox[3] - bbox[1] < 48:
                continue
            crop = image.crop(tuple(float(value) for value in bbox))
            embedding = self._embed(crop)
            species = self._classify_pet(embedding)
            if species is None:
                continue
            found.append(
                DetectedPet(
                    bbox=bbox,
                    score=float(score),
                    label=species,
                    embedding=embedding,
                )
            )

        return found

    def classify_face_candidate(self, image: Image.Image) -> DetectedPet | None:
        """Recover a cat or dog face that the whole-animal detector missed.

        This deliberately only runs on a YuNet face candidate. It is not a
        general image classifier, which keeps a pet-looking background from
        creating a phantom entry in People & Pets.
        """
        if not self.is_loaded:
            raise RuntimeError("The pet models are not loaded")

        embedding = self._embed(image)
        scores = self._pet_scores(embedding)
        label = max(("cat", "dog"), key=scores.__getitem__)
        strongest_non_pet = max(
            score for candidate, score in scores.items() if candidate not in {"cat", "dog"}
        )

        # Require both a meaningful match and a clear win over a human face.
        # The values are cosine similarities from the same normalised CLIP
        # space; 0.015 keeps close-up cats from becoming people while leaving
        # actual people comfortably on the human side of the boundary.
        if scores[label] < 0.24 or scores[label] - strongest_non_pet < 0.015:
            return None

        width, height = image.size
        return DetectedPet(
            bbox=np.array([0, 0, width, height], dtype=np.float32),
            score=scores[label],
            label=label,
            embedding=embedding,
        )

    def _pet_scores(self, embedding: np.ndarray) -> dict[str, float]:
        return {
            label: float(np.dot(embedding, prototype))
            for label, prototype in self._candidate_text_embeddings.items()
        }

    def _classify_pet(self, embedding: np.ndarray) -> str | None:
        """Verify NanoDet's crop and classify only unambiguous cats or dogs.

        NanoDet proposes the box; CLIP must still prefer a pet over people,
        vehicles and generic scenery. Ambiguous cat/dog crops remain a generic
        pet instead of displaying a confidently wrong species badge.
        """
        scores = self._pet_scores(embedding)
        winner = max(("cat", "dog"), key=scores.__getitem__)
        loser = "dog" if winner == "cat" else "cat"
        strongest_non_pet = max(
            score for label, score in scores.items() if label not in {"cat", "dog"}
        )
        if scores[winner] < 0.23 or scores[winner] - strongest_non_pet < 0.015:
            return None
        if scores[winner] - scores[loser] < 0.02:
            return "pet"
        return winner

    @staticmethod
    def _letterbox(image: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
        height, width = image.shape[:2]
        scale = min(NANODET_SIZE / width, NANODET_SIZE / height)
        resized_width, resized_height = round(width * scale), round(height * scale)
        resized = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_AREA)
        top = (NANODET_SIZE - resized_height) // 2
        left = (NANODET_SIZE - resized_width) // 2
        letterboxed = cv2.copyMakeBorder(
            resized,
            top,
            NANODET_SIZE - resized_height - top,
            left,
            NANODET_SIZE - resized_width - left,
            cv2.BORDER_CONSTANT,
            value=0,
        )
        return letterboxed, (top, left, resized_height, resized_width)

    @staticmethod
    def _unletterbox(bbox: np.ndarray, original_shape: tuple[int, int], scale: tuple[int, int, int, int]) -> np.ndarray:
        height, width = original_shape
        top, left, resized_height, resized_width = scale
        bbox[[0, 2]] = np.clip((bbox[[0, 2]] - left) * width / resized_width, 0, width)
        bbox[[1, 3]] = np.clip((bbox[[1, 3]] - top) * height / resized_height, 0, height)
        return bbox

    @staticmethod
    def _make_anchors() -> list[np.ndarray]:
        anchors = []
        for stride in NANODET_STRIDES:
            grid = np.arange(NANODET_SIZE // stride)
            x, y = np.meshgrid(grid, grid)
            anchors.append(np.column_stack((x.ravel() * stride + 0.5 * (stride - 1), y.ravel() * stride + 0.5 * (stride - 1))))
        return anchors

    def _postprocess(self, outputs: list[np.ndarray]) -> np.ndarray:
        class_scores, box_distributions = outputs[::2], outputs[1::2]
        boxes, scores = [], []
        projection = np.arange(NANODET_REG_MAX + 1, dtype=np.float32)

        for stride, class_score, distribution, anchors in zip(
            NANODET_STRIDES, class_scores, box_distributions, self._anchors, strict=True
        ):
            class_score = np.squeeze(class_score, axis=0)
            distribution = np.squeeze(distribution, axis=0).reshape(-1, 4, NANODET_REG_MAX + 1)
            distribution = np.exp(distribution - distribution.max(axis=2, keepdims=True))
            distribution /= distribution.sum(axis=2, keepdims=True)
            distances = distribution @ projection * stride

            max_scores = class_score.max(axis=1)
            top = np.argsort(max_scores)[-1000:]
            selected_anchors, selected_distances, selected_scores = anchors[top], distances[top], class_score[top]
            boxes.append(
                np.column_stack(
                    (
                        selected_anchors[:, 0] - selected_distances[:, 0],
                        selected_anchors[:, 1] - selected_distances[:, 1],
                        selected_anchors[:, 0] + selected_distances[:, 2],
                        selected_anchors[:, 1] + selected_distances[:, 3],
                    )
                )
            )
            scores.append(selected_scores)

        boxes = np.clip(np.concatenate(boxes), 0, NANODET_SIZE)
        scores = np.concatenate(scores)
        class_ids = scores.argmax(axis=1)
        confidences = scores.max(axis=1)
        candidate_indices = np.where(np.isin(class_ids, list(PET_CLASS_IDS)) & (confidences >= self.min_score))[0]
        if not len(candidate_indices):
            return np.empty((0, 6), dtype=np.float32)

        candidate_boxes = boxes[candidate_indices]
        # Cat and dog predictions often overlap on the same animal. Suppress
        # across both classes, then let CLIP classify the surviving pet crop.
        keep = cv2.dnn.NMSBoxes(
            np.column_stack((candidate_boxes[:, :2], candidate_boxes[:, 2:] - candidate_boxes[:, :2])).tolist(),
            confidences[candidate_indices].tolist(),
            self.min_score,
            0.6,
        )
        if len(keep) == 0:
            return np.empty((0, 6), dtype=np.float32)
        indices = candidate_indices[np.asarray(keep).reshape(-1)]
        return np.column_stack((boxes[indices], confidences[indices], class_ids[indices]))

    def _embed(self, crop: Image.Image) -> np.ndarray:
        tensor = self._preprocess(crop).unsqueeze(0)
        with self._torch.no_grad():
            features = self._clip.encode_image(tensor)
        vector = features[0].cpu().numpy().astype(np.float32)
        norm = np.linalg.norm(vector)
        return vector / norm if norm > 0 else vector
