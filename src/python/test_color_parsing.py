#!/usr/bin/env python3
"""
Test color extraction from Build123d code.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from cad_engine import extract_colors

# Test code with various color assignments
test_code = """
from build123d import *

with BuildPart() as part:
    Box(20, 20, 10)
    with Locations((0, 0, 10)):
        Hole(radius=4, depth=10)

# Assign colors
part.color = Color("blue")
base_feature = part.part.solids()[0]
base_feature.color = Color("red")

# RGB color
another_part = Box(10, 10, 10)
another_part.color = Color(0.5, 0.8, 0.2)
"""

colors = extract_colors(test_code)
print("Extracted colors:")
for var_name, color in colors.items():
    print(f"  {var_name}: {color}")

# Expected output:
# part: blue
# base_feature: red
# another_part: #7fcc33 (RGB converted to hex)
