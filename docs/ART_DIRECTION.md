# Photographic art direction

Cookout 2 deliberately uses simple 3D geometry and flat sprites. Realism comes
from the raster source imagery: ordinary lighting, plausible proportions,
recognizable household materials, and clean photographic cutouts. Nearest
filtering and small atlas cells provide the period-game texture cadence without
turning the source photographs into illustrated pixel art.

## Generated asset inventory

All files live in `public/assets/cookout/` and were generated with OpenAI's
built-in image generation tool in imagegen mode.

| File | Generation brief |
| --- | --- |
| `texture-atlas.png` | Exact 4-by-2 atlas of straight-on stock photographs: grass, fence boards, brick, concrete, house siding, garden soil, hedge leaves, and red gingham cloth. Flat light, tileable framing, no labels. |
| `grillmaster-frames.png` | Four transparent full-body stock-photo cutouts of the same backyard competitor: idle, run, fire, and hit reactions. Consistent scale, front-biased game-sprite framing, natural clothing and light. |
| `viewmodel-frames.png` | Four transparent first-person stock-photo frames of real hands holding a compact sporting carbine: idle, firing, magazine out, and magazine in. Fixed camera framing and believable recoil. |
| `viewmodel-movement-frames.png` | Four transparent first-person stock-photo frames of the same hands and carbine: idle, left step, right step, and sprint-lowered pose. |
| `weapon-atlas.png` | Four isolated transparent product-photo cutouts: carbine, pump shotgun, scoped rifle, and launcher-like sporting prop. Consistent side view and ordinary studio lighting. |
| `prop-atlas.png` | Four isolated transparent backyard stock-photo cutouts: gas grill, picnic table, cooler, and patio umbrella. |
| `fx-atlas.png` | Four isolated transparent photographic effects: airborne projectile, muzzle flash, smoke puff, and dirt impact. |
| `cover.png` | Square stock-photo-style catalog hero: an ordinary backyard competitor beside a gas grill, gingham table, cooler, umbrella, fence, hedge, and grill smoke at golden hour. No text or UI. |

The images are presented as low-resolution texture cells, camera-facing world
sprites, true-3D projectile sprites, and the fixed first-person viewmodel layer.
