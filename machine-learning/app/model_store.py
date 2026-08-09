"""Verified downloads for the small, permissively licensed model files."""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from urllib.request import urlopen

log = logging.getLogger("imadeo.ml.models")


class ModelStore:
    """Keeps model downloads in the persistent cache and verifies their bytes."""

    def __init__(self) -> None:
        self.root = Path(os.getenv("ML_MODEL_CACHE", "/cache/imadeo-models"))

    def fetch(self, name: str, url: str, sha256: str) -> Path:
        destination = self.root / name
        if destination.exists() and self._sha256(destination) == sha256:
            return destination

        self.root.mkdir(parents=True, exist_ok=True)
        partial = destination.with_suffix(f"{destination.suffix}.part")
        log.info("downloading %s", name)
        digest = hashlib.sha256()

        with urlopen(url, timeout=60) as response, partial.open("wb") as file:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                file.write(chunk)

        actual = digest.hexdigest()
        if actual != sha256:
            partial.unlink(missing_ok=True)
            raise RuntimeError(f"Checksum mismatch for {name}: expected {sha256}, got {actual}")

        partial.replace(destination)
        return destination

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as file:
            while chunk := file.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest()
