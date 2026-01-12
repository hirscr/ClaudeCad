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
    Returns a dictionary mapping feature names to colors.

    Example:
        base.color = Color("blue") -> {"base": "#0000ff"}
        hole.color = Color(1, 0, 0) -> {"hole": "#ff0000"}
    """
    colors = {}

    # Pattern: variable_name.color = Color("color_name")
    named_pattern = r'(\w+)\.color\s*=\s*Color\s*\(\s*["\'](\w+)["\']\s*\)'
    for match in re.finditer(named_pattern, code):
        var_name = match.group(1)
        color_name = match.group(2).lower()
        colors[var_name] = color_name

    # Pattern: variable_name.color = Color(r, g, b)
    rgb_pattern = r'(\w+)\.color\s*=\s*Color\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)'
    for match in re.finditer(rgb_pattern, code):
        var_name = match.group(1)
        r = float(match.group(2))
        g = float(match.group(3))
        b = float(match.group(4))
        # Convert to hex
        hex_color = '#{:02x}{:02x}{:02x}'.format(
            int(r * 255), int(g * 255), int(b * 255)
        )
        colors[var_name] = hex_color

    return colors


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
