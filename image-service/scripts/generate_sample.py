from pathlib import Path
import sys

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.synthetic_plate import create_plate_image


output = Path(__file__).resolve().parents[1] / "samples" / "plate-normal.png"
output.parent.mkdir(parents=True, exist_ok=True)
if not cv2.imwrite(str(output), create_plate_image()):
    raise RuntimeError("Failed to write sample plate image")
print(output)
