from build123d import *

with BuildPart() as part:
    Box(20, 20, 10)
    with Locations((0, 0, 10)):
        Hole(radius=4, depth=10)

export_stl(part.part, "test_cube.stl")
print(f"SUCCESS: Exported test_cube.stl")
print(f"Volume: {part.part.volume:.2f} mm³")
