#!/usr/bin/env python3
"""
Full test of color pipeline:
1. Build123d code with color assignments
2. CAD engine extracts colors
3. Returns geometry + color mapping
"""

from build123d import *

# Create a traffic light model with colored features
with BuildPart() as part:
    # Housing (black box)
    with Locations((0, 0, 0)):
        Box(100, 50, 200)

    # Red light (top)
    with Locations((0, 0, 60)):
        Sphere(15)

    # Yellow light (middle)
    with Locations((0, 0, 0)):
        Sphere(15)

    # Green light (bottom)
    with Locations((0, 0, -60)):
        Sphere(15)

# Assign colors
part.color = Color("darkgray")  # Housing
