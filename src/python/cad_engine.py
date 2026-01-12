#!/usr/bin/env python3
"""
ClaudeCAD Python CAD Engine
Executes Build123d code and exports geometry to glTF/STL format.
"""

import sys
import json
import tempfile
import traceback
import os
import re
from pathlib import Path

try:
    from build123d import *
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "Build123d not installed. Install with: pip install build123d"
    }))
    sys.exit(1)


def read_stdin():
    """Read input from stdin until __END__ delimiter."""
    lines = []
    for line in sys.stdin:
        if line.strip() == '__END__':
            break
        lines.append(line)
    return ''.join(lines)


def execute_build123d(code):
    """
    Execute Build123d code in an isolated namespace.
    Returns the 'part' object if successful, raises exception otherwise.
    """
    # Create namespace with Build123d imports
    namespace = {
        '__builtins__': __builtins__,
    }

    # Import all Build123d symbols into namespace
    from build123d import __all__ as build123d_exports
    import build123d
    for name in dir(build123d):
        if not name.startswith('_'):
            namespace[name] = getattr(build123d, name)

    # Execute the user code
    exec(code, namespace)

    # Look for a 'part' variable in the namespace
    if 'part' not in namespace:
        raise ValueError("No 'part' variable found in code. Please assign your geometry to a variable named 'part'.")

    return namespace['part'], namespace


def extract_colors(code):
    """
    Extract color assignments from Build123d code.
    Returns a dictionary mapping feature indices to hex colors.

    The function:
    1. Extracts variable_name -> color mappings from .color = Color(...) assignments
    2. Finds the order of parts in Compound([...]) or part = variable assignments
    3. Returns {0: "#ff0000", 1: "#0000ff", ...} by index

    Example:
        cube.color = Color("blue")
        sphere.color = Color(1, 0, 0)
        part = Compound([cube, sphere])
        -> {0: "#0000ff", 1: "#ff0000"}
    """
    # Named color to hex mapping
    color_name_to_hex = {
        'red': '#ff0000',
        'green': '#00ff00',
        'blue': '#0000ff',
        'yellow': '#ffff00',
        'cyan': '#00ffff',
        'magenta': '#ff00ff',
        'white': '#ffffff',
        'black': '#000000',
        'orange': '#ff9900',
        'purple': '#800080',
        'pink': '#ffc0cb',
        'gray': '#808080',
        'grey': '#808080',
    }

    # Step 1: Extract variable -> color mappings
    var_colors = {}

    # Pattern: variable_name.color = Color("color_name")
    named_pattern = r'(\w+)\.color\s*=\s*Color\s*\(\s*["\'](\w+)["\']\s*\)'
    for match in re.finditer(named_pattern, code):
        var_name = match.group(1)
        color_name = match.group(2).lower()
        hex_color = color_name_to_hex.get(color_name, '#808080')
        var_colors[var_name] = hex_color

    # Pattern: variable_name.color = Color(r, g, b)
    rgb_pattern = r'(\w+)\.color\s*=\s*Color\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)'
    for match in re.finditer(rgb_pattern, code):
        var_name = match.group(1)
        r = float(match.group(2))
        g = float(match.group(3))
        b = float(match.group(4))
        hex_color = '#{:02x}{:02x}{:02x}'.format(
            int(r * 255), int(g * 255), int(b * 255)
        )
        var_colors[var_name] = hex_color

    # DEBUG: Log var_colors found
    print(f"[DEBUG extract_colors] var_colors found: {var_colors}", file=sys.stderr)

    if not var_colors:
        return {}

    # Step 2: Find the order of SHAPE CREATIONS in the code
    # This determines the order meshes appear in the glTF file
    # Pattern: var = ShapeConstructor(...) where ShapeConstructor is a Build123d shape
    shape_constructors = [
        'Box', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'Wedge',
        'CounterBoreHole', 'CounterSinkHole', 'Hole',
        'Extrude', 'Revolve', 'Sweep', 'Loft',
        'Circle', 'Ellipse', 'Rectangle', 'Polygon', 'RegularPolygon',
        'Text', 'Arc', 'Line', 'Spline', 'Helix',
        'fillet', 'chamfer', 'shell', 'offset',
        'add', 'cut', 'intersect',
    ]
    shape_pattern = r'(\w+)\s*=\s*(' + '|'.join(shape_constructors) + r')\s*\('

    # Find all shape creations in order they appear in code
    shape_order = []
    for match in re.finditer(shape_pattern, code, re.IGNORECASE):
        var_name = match.group(1)
        shape_type = match.group(2)
        print(f"[DEBUG extract_colors] Found shape: {var_name} = {shape_type}(...)", file=sys.stderr)
        if var_name not in shape_order:  # Avoid duplicates from reassignment
            shape_order.append(var_name)

    # DEBUG: Log shape_order
    print(f"[DEBUG extract_colors] shape_order: {shape_order}", file=sys.stderr)

    # Step 3: Map colors to indices based on shape creation order
    if shape_order:
        indexed_colors = {}
        for idx, var_name in enumerate(shape_order):
            if var_name in var_colors:
                indexed_colors[idx] = var_colors[var_name]
                print(f"[DEBUG extract_colors] Mapping: index {idx} ({var_name}) -> {var_colors[var_name]}", file=sys.stderr)

        if indexed_colors:
            print(f"[DEBUG extract_colors] FINAL indexed_colors: {indexed_colors}", file=sys.stderr)
            return indexed_colors

    # Step 4: Check for Compound([...]) as fallback
    # Pattern: Compound([var1, var2, ...]) or Compound(children=[var1, var2, ...])
    compound_pattern = r'Compound\s*\(\s*(?:children\s*=\s*)?\[([^\]]+)\]'
    compound_match = re.search(compound_pattern, code)

    if compound_match:
        # Extract variable names from the list
        parts_str = compound_match.group(1)
        # Split by comma and strip whitespace
        part_names = [name.strip() for name in parts_str.split(',') if name.strip()]

        # Build index -> color mapping
        indexed_colors = {}
        for idx, part_name in enumerate(part_names):
            if part_name in var_colors:
                indexed_colors[idx] = var_colors[part_name]

        return indexed_colors

    # Step 5: If no shape order found, check for simple part = variable (single object)
    # Pattern: part = variable_name (at end or followed by newline/comment)
    single_part_pattern = r'part\s*=\s*(\w+)\s*(?:#.*)?$'
    single_match = re.search(single_part_pattern, code, re.MULTILINE)

    if single_match:
        var_name = single_match.group(1)
        if var_name in var_colors:
            return {0: var_colors[var_name]}

    # Final fallback: return colors by order they appear in code
    indexed_colors = {}
    for idx, (var_name, color) in enumerate(var_colors.items()):
        indexed_colors[idx] = color

    return indexed_colors


def export_mesh(part):
    """
    Export Build123d part to mesh format (glTF preferred, STL fallback).
    Returns the file path of the exported mesh.
    """
    # Create temporary file
    temp_dir = tempfile.gettempdir()

    # Try glTF export first (better for Three.js)
    try:
        gltf_path = os.path.join(temp_dir, f"claudecad_{os.getpid()}.glb")
        export_gltf(part, gltf_path)
        return gltf_path
    except Exception as gltf_error:
        # Fall back to STL
        try:
            stl_path = os.path.join(temp_dir, f"claudecad_{os.getpid()}.stl")
            export_stl(part, stl_path)
            return stl_path
        except Exception as stl_error:
            raise Exception(f"glTF export failed: {gltf_error}. STL export also failed: {stl_error}")


def handle_export_stl(code, output_path):
    """
    Export Build123d code to STL file.
    Args:
        code: Build123d Python code
        output_path: Path where STL should be written
    Returns:
        JSON response with success/error
    """
    try:
        # Execute the code
        part, namespace = execute_build123d(code)

        # Export to binary STL (part.part is the actual geometry)
        export_stl(part.part, output_path)

        # Success response
        print(json.dumps({
            "success": True,
            "output_path": output_path
        }))

    except SyntaxError as e:
        print(json.dumps({
            "success": False,
            "error": f"Syntax error: {e.msg} at line {e.lineno}"
        }))

    except Exception as e:
        # Capture full traceback for debugging
        error_trace = traceback.format_exc()
        print(json.dumps({
            "success": False,
            "error": str(e),
            "traceback": error_trace
        }))


def main():
    """Main entry point."""
    try:
        # Read Build123d code from stdin
        code = read_stdin()

        if not code.strip():
            print(json.dumps({
                "success": False,
                "error": "No code provided on stdin"
            }))
            return

        # Execute the code
        part, namespace = execute_build123d(code)

        # Check if geometry is empty (e.g., user said "delete everything")
        if part.part is None:
            print(json.dumps({
                "success": True,
                "empty": True,
                "mesh_path": None,
                "colors": {}
            }))
            return

        # Export to mesh format (part.part is the actual geometry)
        mesh_path = export_mesh(part.part)

        # Extract color information from code
        colors = extract_colors(code)

        # Calculate volume (Build123d provides this in cubic mm)
        volume = part.part.volume

        # Success response
        print(json.dumps({
            "success": True,
            "mesh_path": mesh_path,
            "colors": colors,
            "volume": volume
        }))

    except SyntaxError as e:
        print(json.dumps({
            "success": False,
            "error": f"Syntax error: {e.msg} at line {e.lineno}"
        }))

    except Exception as e:
        # Capture full traceback for debugging
        error_trace = traceback.format_exc()
        print(json.dumps({
            "success": False,
            "error": str(e),
            "traceback": error_trace
        }))


if __name__ == "__main__":
    # Check for command-line arguments to determine mode
    if len(sys.argv) > 1 and sys.argv[1] == 'export_stl':
        # Export STL mode: expect output path as second argument
        if len(sys.argv) < 3:
            print(json.dumps({
                "success": False,
                "error": "No output path provided for STL export"
            }))
            sys.exit(1)

        output_path = sys.argv[2]
        code = read_stdin()
        handle_export_stl(code, output_path)
    else:
        # Default mode: generate mesh for viewport
        main()
