#!/usr/bin/env python3
"""
Test Build123d color assignment and glTF export.
Creates a multi-body model with different colors and exports to glTF.
"""

from build123d import *
import os

# Create multiple shapes with different colors
print("Creating colored shapes...")

# Red sphere
red_sphere = Solid.make_sphere(10)
red_sphere.color = Color("red")

# Blue box
blue_box = Solid.make_box(15, 15, 15)
blue_box.color = Color("blue")
blue_box = blue_box.move(Location((30, 0, 0)))

# Green cylinder
green_cylinder = Solid.make_cylinder(8, 20)
green_cylinder.color = Color("green")
green_cylinder = green_cylinder.move(Location((0, 30, 0)))

# Yellow cone
yellow_cone = Solid.make_cone(10, 0, 20)
yellow_cone.color = Color("yellow")
yellow_cone = yellow_cone.move(Location((30, 30, 0)))

# Combine into a compound
compound = Compound([red_sphere, blue_box, green_cylinder, yellow_cone])

# Export to glTF
output_path = "test_colors.glb"
print(f"Exporting to {output_path}...")
export_gltf(compound, output_path)

print(f"✓ Successfully exported to {output_path}")
print(f"  File size: {os.path.getsize(output_path)} bytes")
print("\nTo test:")
print("1. Open in a glTF viewer (e.g., https://gltf-viewer.donmccurdy.com/)")
print("2. Verify that each shape has its assigned color")
