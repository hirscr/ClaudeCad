# BB-8 Droid (10cm tall)

Create BB-8 as a 3D solid.

## Coordinate system
- X = left/right
- Z = up/down
- +Y = front (main eye points toward +Y)
- Units: millimeters
- Symmetric about YZ plane (X = 0) except for secondary eye
- Use only: sphere, cylinder, box, union, subtract

---

## 1) Body (main sphere)
- Sphere: diameter 70mm
- Center at (0, 0, 35) — sitting on ground plane

---

## 2) Head (dome)
- Hemisphere: radius 20mm
- Center at (0, 0, 79)
- **Important:** Flat side faces DOWN, rounded side faces UP
- Creates a 3-4mm visible gap between bottom of head dome and top of body sphere
- Optional: small fillet on bottom edge of dome

---

## 3) Main eye lens
- Cylinder: diameter 14mm, depth 4mm, axis along Y
- Center at (0, 18, 84)
- Subtract inner recess: cylinder diameter 10mm, depth 2mm

---

## 4) Secondary eye (smaller, offset to right)
- Cylinder: diameter 8mm, depth 3mm, axis along Y
- Center at (8, 17, 78)

---

## 5) Antennas (two thin cylinders)
- Two cylinders: diameter 1mm, height 15mm, axis along Z
- **Must be attached to top of head dome**
- Left antenna center: (-5, -3, 97)
- Right antenna center: (5, -3, 97)

---

## 6) Body center panel (large circular ring)
- Outer cylinder: diameter 25mm, depth 2mm, axis along Y
- Center at (0, 34, 35)
- Subtract inner circle: diameter 18mm, depth 2mm — creates ring effect

---

## 7) Body side panels
- Two cylinders: diameter 15mm, depth 2mm, axis along X
- Left panel center: (-34, 0, 40)
- Right panel center: (34, 0, 40)

---

## 8) Accent details (small circular bumps)
- Four cylinders: diameter 8mm, depth 1.5mm
- Upper pair at Z=50mm:
  - (12, 30, 50)
  - (-12, 30, 50)
- Lower pair at Z=22mm:
  - (15, 28, 22)
  - (-15, 28, 22)

---

## 9) Body bottom panel
- Cylinder: diameter 20mm, depth 2mm, axis along Z (pointing down)
- Center at (0, 0, 2)

---

## Summary
A stylized BB-8 droid with:
- Round 70mm body sphere
- Dome head floating 3-4mm above body
- Asymmetric eyes (one large, one small)
- Two thin antennas on top
- Circular panel details on body
