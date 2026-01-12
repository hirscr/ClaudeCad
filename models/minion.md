# Minion (10cm tall)

Create a Minion character as a 3D solid.

## Coordinate system
- X = left/right
- Z = up/down
- +Y = front (face points toward +Y)
- Units: millimeters
- Keep everything symmetric about the YZ plane (mirror across X = 0)
- Use only: sphere, cylinder, box, union, subtract

---

## 1) Body (pill shape)
- Cylinder: diameter 40mm, height 50mm, centered at (0, 0, 50)
- Top hemisphere: sphere radius 20mm, center at (0, 0, 75) - union upper half only via intersection with box
- Bottom hemisphere: sphere radius 20mm, center at (0, 0, 25) - union lower half only
- Or simpler: just use a full sphere at top (radius 20mm at Z=75) and full sphere at bottom (radius 20mm at Z=25), union with cylinder

---

## 2) Goggle band
- Cylinder (ring): outer diameter 42mm, inner diameter 38mm (subtract inner), height 8mm
- Center at (0, 0, 70)
- This wraps around the head

---

## 3) Goggle lens housing (single eye - Stuart style)
- Cylinder: diameter 22mm, depth 8mm, axis along Y
- Center at (0, 17, 72)
- Union to body

---

## 4) Eye
- White of eye: sphere diameter 18mm, center at (0, 18, 72)
- Iris: sphere diameter 10mm, center at (0, 22, 72) - brown area (just geometry, no color)
- Pupil: sphere diameter 5mm, center at (0, 24, 72) - subtract slightly or union as black dot

---

## 5) Mouth
- Smile groove: subtract a cylinder (radius 12mm, length 30mm, axis along X)
- Position cylinder center at (0, 18, 50)
- Limit cut with intersection box: 20mm wide × 10mm deep × 6mm tall, centered at (0, 18, 52)

---

## 6) Overalls (simplified as band)
- Box representing overall bib: 30mm wide × 5mm deep × 35mm tall
- Center at (0, 18, 35)
- Union to body
- Optional: subtract two small cylinders for overall buttons at (-8, 20, 50) and (8, 20, 50), radius 2mm

---

## 7) Arms
- Two cylinders: diameter 6mm, length 30mm, axis along X (pointing outward)
- Left arm center: (-23, 0, 55)
- Right arm center: (23, 0, 55)
- Union to body

---

## 8) Legs
- Two cylinders: diameter 10mm, height 20mm, axis along Z
- Left leg center: (-10, 0, 10)
- Right leg center: (10, 0, 10)
- Union to body

---

## 9) Feet (simple boxes)
- Two boxes: 14mm wide × 20mm deep × 6mm tall
- Left foot center: (-10, 2, 3)
- Right foot center: (10, 2, 3)
- Union to body
