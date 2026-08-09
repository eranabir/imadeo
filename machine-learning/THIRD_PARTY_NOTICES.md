# Machine-learning notices

Imadeo downloads the following model files into the local model cache. They are
not sent to, or run by, any third-party service.

| Component | Use | License | Source |
| --- | --- | --- | --- |
| YuNet | Human face detection | MIT | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| SFace | Human face embeddings | Apache-2.0 | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |
| NanoDet | Cat and dog detection | Apache-2.0 | [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_nanodet) |
| OpenCLIP | Image search and pet appearance embeddings | MIT | [OpenCLIP](https://github.com/mlfoundations/open_clip) |

The service verifies the SHA-256 checksum for each OpenCV Zoo ONNX file before
loading it. When redistributing Imadeo, retain the upstream MIT and Apache-2.0
license notices and verify the license of every configured CLIP checkpoint.
