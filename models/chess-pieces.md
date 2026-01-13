# Chess Pieces

Create chess pieces as 3D models using Compound (not BuildPart).

## Coordinate System
- Z = up/down, Y = forward/back, X = left/right
- All pieces stand upright along Z
- Units: millimeters

---

# PAWN (35mm tall)

## 1) Base
- Cylinder: diameter 20mm, height 5mm, standing upright
- Center at (0, 0, 2.5)

## 2) Lower body
- Cone: base radius 8mm, top radius 5mm, height 15mm, pointing up
- Center at (0, 0, 12.5)

## 3) Collar
- Cylinder: diameter 12mm, height 2mm
- Center at (0, 0, 21)

## 4) Head
- Sphere: diameter 12mm
- Center at (0, 0, 29)

---

# ROOK (40mm tall)

## 1) Base
- Cylinder: diameter 22mm, height 5mm
- Center at (0, 0, 2.5)

## 2) Tower body
- Cylinder: diameter 16mm, height 25mm
- Center at (0, 0, 17.5)

## 3) Top platform
- Cylinder: diameter 20mm, height 4mm
- Center at (0, 0, 32)

## 4) Battlements
- Four boxes: 6mm × 6mm × 6mm each
- At (6, 6, 37), (-6, 6, 37), (6, -6, 37), (-6, -6, 37)

---

# KNIGHT (45mm tall)

## 1) Base
- Cylinder: diameter 22mm, height 5mm
- Center at (0, 0, 2.5)

## 2) Body
- Cylinder: diameter 14mm, height 15mm
- Center at (0, 0, 12.5)

## 3) Neck
- Cylinder: diameter 10mm, height 15mm, tilted forward
- Center at (0, 5, 27)

## 4) Head
- Box: 10mm × 20mm × 12mm
- Center at (0, 12, 38)

## 5) Ears
- Two cones: base radius 2mm, height 6mm, pointing up
- At (-3, 8, 46) and (3, 8, 46)

---

# BISHOP (50mm tall)

## 1) Base
- Cylinder: diameter 22mm, height 5mm
- Center at (0, 0, 2.5)

## 2) Lower body
- Cone: base radius 10mm, top radius 6mm, height 20mm, pointing up
- Center at (0, 0, 15)

## 3) Collar
- Cylinder: diameter 14mm, height 3mm
- Center at (0, 0, 26.5)

## 4) Upper body
- Sphere: diameter 14mm
- Center at (0, 0, 35)

## 5) Tip
- Sphere: diameter 5mm
- Center at (0, 0, 46)

---

# QUEEN (55mm tall)

## 1) Base
- Cylinder: diameter 24mm, height 5mm
- Center at (0, 0, 2.5)

## 2) Lower body
- Cone: base radius 11mm, top radius 7mm, height 22mm, pointing up
- Center at (0, 0, 16)

## 3) Collar
- Cylinder: diameter 16mm, height 3mm
- Center at (0, 0, 29.5)

## 4) Upper body
- Sphere: diameter 16mm
- Center at (0, 0, 39)

## 5) Crown base
- Cylinder: diameter 12mm, height 4mm
- Center at (0, 0, 49)

## 6) Crown ball
- Sphere: diameter 6mm
- Center at (0, 0, 54)

---

# KING (60mm tall)

## 1) Base
- Cylinder: diameter 24mm, height 5mm
- Center at (0, 0, 2.5)

## 2) Lower body
- Cone: base radius 11mm, top radius 7mm, height 25mm, pointing up
- Center at (0, 0, 17.5)

## 3) Collar
- Cylinder: diameter 16mm, height 3mm
- Center at (0, 0, 31.5)

## 4) Upper body
- Sphere: diameter 16mm
- Center at (0, 0, 41)

## 5) Crown platform
- Cylinder: diameter 10mm, height 4mm
- Center at (0, 0, 51)

## 6) Cross vertical
- Box: 4mm × 4mm × 10mm
- Center at (0, 0, 58)

## 7) Cross horizontal
- Box: 12mm × 4mm × 4mm
- Center at (0, 0, 58)

---

## Colors
- White pieces: white or ivory
- Black pieces: dark gray or black
