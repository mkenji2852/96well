import cv2
import numpy as np


def create_plate_image(blur_kernel: int = 0) -> np.ndarray:
    image = np.full((700, 1040, 3), 205, dtype=np.uint8)
    cv2.rectangle(image, (90, 50), (950, 650), (235, 235, 235), -1)
    cv2.rectangle(image, (90, 50), (950, 650), (45, 45, 45), 5)
    for row in range(8):
        for column in range(12):
            center = (135 + column * 70, 105 + row * 70)
            growth = (row + column) % 3 == 0
            fill = 85 if growth else 225
            cv2.circle(image, center, 24, (35, 35, 35), 3)
            cv2.circle(image, center, 20, (fill, fill, fill), -1)
            if growth:
                for offset in (-8, 0, 8):
                    cv2.circle(image, (center[0] + offset, center[1] - offset // 2), 2, (30, 30, 30), -1)
    if blur_kernel:
        image = cv2.GaussianBlur(image, (blur_kernel, blur_kernel), 0)
    return image

