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


def color_to_hex(color):
    """Convert Build123d Color object to hex string."""
    if color is None:
        return None
    try:
        # Color.wrapped is the OCP color with Red(), Green(), Blue() methods (0-1 range)
        r = int(color.wrapped.Red() * 255)
        g = int(color.wrapped.Green() * 255)
        b = int(color.wrapped.Blue() * 255)
        return '#{:02x}{:02x}{:02x}'.format(r, g, b)
    except Exception:
        return None


def extract_shape_info(part):
    """
    Extract individual solids from a part with their colors.
    Uses TopExp_Explorer to iterate through all SOLID shapes.

    Args:
        part: The Build123d part object (geometry)

    Returns:
        List of dicts: [{solid: Solid, color: "#hex" or None, label: "shape_N"}, ...]
    """
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from build123d import Solid

    shapes = []

    # Use TopExp_Explorer to iterate all solids in the geometry
    explorer = TopExp_Explorer(part.wrapped, TopAbs_SOLID)
    idx = 0

    while explorer.More():
        solid_wrapped = explorer.Current()
        solid = Solid(solid_wrapped)

        # Try to get color directly from the solid
        hex_color = None
        if hasattr(solid, 'color') and solid.color:
            hex_color = color_to_hex(solid.color)

        # Default to gray if no color
        if hex_color is None:
            hex_color = "#888888"

        shapes.append({
            'solid': solid,
            'color': hex_color,
            'label': f'shape_{idx}'
        })

        explorer.Next()
        idx += 1

    # If no solids found, treat the whole part as a single shape
    if not shapes:
        hex_color = None
        if hasattr(part, 'color') and part.color:
            hex_color = color_to_hex(part.color)
        if hex_color is None:
            hex_color = "#888888"

        shapes.append({
            'solid': part,
            'color': hex_color,
            'label': 'shape_0'
        })

    print(f"[DEBUG extract_shape_info] Found {len(shapes)} shapes", file=sys.stderr)
    return shapes


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

    # Step 0: Build color variable lookup table
    # Pattern: varname = Color(r, g, b) where r,g,b are simple floats
    color_vars = {}

    # Match: varname = Color(r, g, b)
    var_color_def_pattern = r'^(\w+)\s*=\s*Color\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)'
    for match in re.finditer(var_color_def_pattern, code, re.MULTILINE):
        var_name = match.group(1)
        r = float(match.group(2))
        g = float(match.group(3))
        b = float(match.group(4))
        hex_color = '#{:02x}{:02x}{:02x}'.format(
            int(r * 255), int(g * 255), int(b * 255)
        )
        color_vars[var_name] = hex_color

    # Match: varname = Color("color_name")
    var_color_named_pattern = r'^(\w+)\s*=\s*Color\s*\(\s*["\'](\w+)["\']\s*\)'
    for match in re.finditer(var_color_named_pattern, code, re.MULTILINE):
        var_name = match.group(1)
        color_name = match.group(2).lower()
        hex_color = color_name_to_hex.get(color_name, '#808080')
        color_vars[var_name] = hex_color

    print(f"[DEBUG extract_colors] color_vars lookup table: {color_vars}", file=sys.stderr)

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

    # Pattern: variable_name.color = color_variable (variable reference)
    var_ref_pattern = r'(\w+)\.color\s*=\s*(\w+)\s*$'
    for match in re.finditer(var_ref_pattern, code, re.MULTILINE):
        shape_name = match.group(1)
        color_var_name = match.group(2)
        # Look up the color variable in our lookup table
        if color_var_name in color_vars:
            var_colors[shape_name] = color_vars[color_var_name]
            print(f"[DEBUG extract_colors] Resolved {shape_name}.color = {color_var_name} -> {color_vars[color_var_name]}", file=sys.stderr)

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


def export_meshes(shapes_info):
    """
    Export each shape to its own glTF file.

    Args:
        shapes_info: List from extract_shape_info [{solid, color, label}, ...]

    Returns:
        List of dicts: [{mesh_path: str, color: str, label: str}, ...]
    """
    temp_dir = tempfile.gettempdir()
    results = []

    for i, shape_info in enumerate(shapes_info):
        solid = shape_info['solid']
        gltf_path = os.path.join(temp_dir, f"claudecad_{os.getpid()}_{i}.glb")

        try:
            from build123d import Location
            # Save original location
            original_location = solid.location
            # Apply +90° X via location transform (composes with export_gltf's -90°)
            solid.location *= Location((0, 0, 0), (1, 0, 0), 90)
            export_gltf(solid, gltf_path)
            # Restore original location to avoid side effects
            solid.location = original_location
            results.append({
                'mesh_path': gltf_path,
                'color': shape_info['color'],
                'label': shape_info['label']
            })
            print(f"[DEBUG export_meshes] Exported shape {i} ({shape_info['label']}) to {gltf_path}", file=sys.stderr)
        except Exception as e:
            print(f"[ERROR export_meshes] Failed to export shape {i}: {e}", file=sys.stderr)
            # Continue with other shapes

    return results


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

        # Handle both BuildPart result (has .part) and direct shapes (Compound, Solid, etc.)
        if hasattr(part, 'part'):
            geometry = part.part
        else:
            geometry = part

        # Export to binary STL
        export_stl(geometry, output_path)

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

        # Handle both BuildPart result (has .part) and direct shapes (Compound, Solid, etc.)
        if hasattr(part, 'part'):
            # BuildPart context manager result
            geometry = part.part
        else:
            # Direct shape (Compound, Solid, etc.)
            geometry = part

        # Check if geometry is empty (e.g., user said "delete everything")
        if geometry is None:
            print(json.dumps({
                "success": True,
                "empty": True,
                "shapes": []
            }))
            return

        # Extract shape information (iterates solids)
        shapes_info = extract_shape_info(geometry)

        # Extract colors from code and apply to shapes by index
        indexed_colors = extract_colors(code)
        for idx, hex_color in indexed_colors.items():
            if idx < len(shapes_info):
                shapes_info[idx]['color'] = hex_color
                print(f"[DEBUG main] Applied color {hex_color} to shape {idx}", file=sys.stderr)

        # Export each shape to its own glTF file
        exported_shapes = export_meshes(shapes_info)

        # Calculate total volume (Build123d provides this in cubic mm)
        volume = geometry.volume

        # Success response with multi-shape format
        print(json.dumps({
            "success": True,
            "shapes": exported_shapes,
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
