import base64
import io
import json
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from server.ai_assist import _qwen_detect


class ModelCoordinateTests(unittest.TestCase):
    def detect(self, data):
        _, png = cv2.imencode(".png", np.zeros((360, 640, 3), dtype=np.uint8))
        response = io.BytesIO(json.dumps({"choices": [{"message": {"content": json.dumps(data)}}]}).encode())
        with patch.dict("os.environ", {"QWEN_API_KEY": "fake-test-key"}), patch("urllib.request.urlopen", return_value=response):
            return _qwen_detect(base64.b64encode(png).decode(), "test")

    def test_normalized_box_is_converted_to_original_image_pixels(self):
        result = self.detect({"coordinate_space": "normalized_1000", "elements": [{"text": "Next", "bbox": [100, 200, 500, 800]}]})
        self.assertEqual(result["elements"][0]["bbox"], [64, 72, 320, 288])
        self.assertEqual(result["elements"][0]["center"], [192, 180])

    def test_unspecified_coordinate_space_falls_back_instead_of_guessing(self):
        self.assertIsNone(self.detect({"elements": [{"bbox": [100, 200, 500, 800]}]}))

    def test_nonfinite_and_out_of_range_boxes_are_discarded(self):
        result = self.detect({"coordinate_space": "normalized_1000", "elements": [{"bbox": [0, 0, float("nan"), 100]}, {"bbox": [0, 0, 1200, 100]}]})
        self.assertEqual(result["elements"], [])


if __name__ == "__main__":
    unittest.main()
