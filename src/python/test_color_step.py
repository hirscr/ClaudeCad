#!/usr/bin/env python3
"""
Test Build123d color assignment and STEP export.
STEP format is known to preserve colors well.
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

# Export to STEP (known to preserve colors)
step_path = "test_colors.step"
print(f"Exporting to {step_path}...")
export_step(compound, step_path)
print(f"✓ Successfully exported to {step_path}")
print(f"  File size: {os.path.getsize(step_path)} bytes")

# Try glTF with binary=True
gltf_path = "test_colors_binary.glb"
print(f"\nExporting to {gltf_path} (binary mode)...")
export_gltf(compound, gltf_path, binary=True)
print(f"✓ Successfully exported to {gltf_path}")
print(f"  File size: {os.path.getsize(gltf_path)} bytes")
