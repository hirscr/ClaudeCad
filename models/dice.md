# D6 Dice (20mm cube)

Create a six-sided die as a multi-colored 3D model using Compound (not BuildPart).

## Coordinate System
- Z = up/down, Y = forward/back, X = left/right
- Units: millimeters

## Face Layout (opposite faces sum to 7)
- Face 1: bottom (-Z)
- Face 6: top (+Z)
- Face 2: front (+Y)
- Face 5: back (-Y)
- Face 3: right (+X)
- Face 4: left (-X)

---

## 1) Cube body
- Box: 20mm × 20mm × 20mm
- Center at (0, 0, 10)
- Color: white

---

## 2) Face 1 - Bottom: One pip
- Sphere: diameter 4mm at (0, 0, 0)
- Color: black

---

## 3) Face 6 - Top: Six pips
- Six spheres diameter 4mm at:
  - (-5, 5, 20), (-5, 0, 20), (-5, -5, 20)
  - (5, 5, 20), (5, 0, 20), (5, -5, 20)
- Color: black

---

## 4) Face 2 - Front: Two pips
- Two spheres diameter 4mm at:
  - (-5, 10, 15), (5, 10, 5)
- Color: black

---

## 5) Face 5 - Back: Five pips
- Five spheres diameter 4mm at:
  - (-5, -10, 15), (5, -10, 15)
  - (0, -10, 10)
  - (-5, -10, 5), (5, -10, 5)
- Color: black

---

## 6) Face 3 - Right: Three pips
- Three spheres diameter 4mm at:
  - (10, -5, 15), (10, 0, 10), (10, 5, 5)
- Color: black

---

## 7) Face 4 - Left: Four pips
- Four spheres diameter 4mm at:
  - (-10, -5, 15), (-10, 5, 15)
  - (-10, -5, 5), (-10, 5, 5)
- Color: black

---

## Colors Summary
- Cube: white
- All pips: black

## Total: 21 pips (1+6+2+5+3+4)
