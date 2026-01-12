from build123d import *

# Create a simple part with multiple features
with BuildPart() as part:
    Box(20, 20, 10)
    with Locations((0, 0, 10)):
        Cylinder(radius=5, height=5)

# Assign colors (note: these will be extracted by CAD engine)
part.color = Color("blue")
