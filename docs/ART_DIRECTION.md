# Photographic LARP art direction

LARP deliberately uses a simple spatial 3D world and flat raster detail. Its
geometry stays primitive; realism comes from recognizable timber, steel,
cloth, grass, skin, fire, and lightning captured with ordinary photographic
lighting and believable proportions.

The presentation is intentionally reminiscent of a premium 2010 iPhone game:
compact low-resolution textures, crisp photo cutouts, warm color grading,
glossy bevels, leather-like panels, stitched borders, and restrained bloom.
The photographs remain photographs rather than illustrations, cartoons, or
overt pixel art.

## Individual-asset rule

Every frame, fighter, pickup, projectile, prop, effect, and surface is stored
as its own image under `public/assets/larp/`. There are no sprite sheets,
atlases, or multi-frame source images. The 61 active WebP files are organized
as follows:

| Directory | Files | Purpose |
| --- | ---: | --- |
| `materials/` | 8 | Grass, dirt, cobblestone, timber, hedge, plaster, and roof photographs wrapped over simple geometry. |
| `props/` | 4 | Individual archery target, canvas tent, hay bale, and wooden cart cutouts. |
| `pickups/` | 8 | One isolated real weapon or magical implement photograph per weapon. |
| `fighters/` | 8 | One forward-facing, attack-ready full-body fighter photograph per weapon. |
| `viewmodels/` | 26 | Separate idle, fire, and reload images for all eight weapons, plus separate draw images for both bows. |
| `effects/` | 6 | Individual arrow, bolt, knife, fireball, lightning, and dust-impact photographs. |
| project root | 1 | The photographic Battle Village cover image. |

The source generations were created with OpenAI's built-in image generation
tool in image-generation mode. Prompts called for standard stock photography,
real steel and wood weapons, natural human proportions, transparent cutouts,
ordinary studio or outdoor lighting, and no foam, toy, illustrated, painted,
or pixel-art treatment.

## First-person framing

Each viewmodel is an independent 768-by-768 transparent image. Idle, attack,
reload, and bow-draw poses have generous transparent space along their top,
left, and right edges, so photographs never terminate in a hard rectangular
cut inside the viewport. Only the lower arms may naturally leave the bottom
edge. Runtime CSS adds weapon-specific recoil, reload arcs, bow-draw movement,
sway, bob, focus, and sprint motion without combining frames into a sheet.

## World sprites and projectiles

Fighter cutouts always aim toward the camera so a head-on opponent visibly
attacks forward. Each weapon swaps to a distinct fighter image. The renderer
uses camera-facing sprites for people and pickups.

Arrows, crossbow bolts, and throwing knives are not generic particles. Each is
an individual transparent photograph on a plane mesh. The mesh's local
horizontal axis is aligned to its actual 3D travel vector every frame while
its plane normal remains camera-readable. Fireballs move through the same
spatial world with server-authoritative gameplay simulation.

Shipped images are downsampled and alpha-preserving WebP files. This retains
the deliberately low-resolution photographic character while reducing the
active raster payload from roughly 81 MB of source PNGs to about 2.8 MB.
