import unittest

import numpy as np

from app.pets import PetEngine


class PetSpeciesClassificationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = PetEngine()
        self.engine._candidate_text_embeddings = {
            "cat": np.array([1.0, 0.0, 0.0], dtype=np.float32),
            "dog": np.array([0.0, 1.0, 0.0], dtype=np.float32),
            "person": np.array([0.0, 0.0, 1.0], dtype=np.float32),
        }

    def test_clip_corrects_a_clear_detector_misclassification(self) -> None:
        embedding = np.array([0.1, 0.9, 0.0], dtype=np.float32)

        self.assertEqual(self.engine._classify_pet(embedding), "dog")

    def test_ambiguous_species_is_kept_as_a_generic_pet(self) -> None:
        embedding = np.array([0.5, 0.51, 0.0], dtype=np.float32)

        self.assertEqual(self.engine._classify_pet(embedding), "pet")

    def test_non_pet_crop_is_rejected(self) -> None:
        embedding = np.array([0.2, 0.21, 0.5], dtype=np.float32)

        self.assertIsNone(self.engine._classify_pet(embedding))


if __name__ == "__main__":
    unittest.main()
