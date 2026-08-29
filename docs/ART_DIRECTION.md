# Photographic LARP art direction

LARP deliberately uses a simple spatial 3D world and flat raster detail. Its
geometry stays primitive; realism comes from recognizable timber, foam,
cardboard, cloth, grass, skin, practical LEDs, fire, and lightning captured
with ordinary photographic lighting and believable proportions.

The presentation is intentionally reminiscent of a quirky 2010 iPhone game:
compact low-resolution textures, crisp live-action cutouts, blunt phone flash,
slightly imperfect white balance, mild sensor noise and JPEG crunch, alongside
square-edged Windows 98 interface chrome supplied by 98.css. The
photographs remain photographs rather than illustrations, cartoons, 3D
renders, polished fantasy concept art, or overt pixel art.

Characters are ordinary adult hobbyists rather than heroic models. The roster
uses varied ages, genders, ethnicities, and mostly heavier body types, thick
prescription glasses, old sneakers, cargo shorts, thrift-store layers, and
visible craft construction. The joke comes from sincere homemade LARP energy,
not distorted anatomy or an artificial-looking person.

## Individual-asset rule

Every frame, fighter, pickup, projectile, prop, effect, and surface is stored
as its own image under `public/assets/larp/`. There are no sprite sheets,
atlases, or multi-frame source images. The 123 active WebP files are organized
as follows:

| Directory | Files | Purpose |
| --- | ---: | --- |
| `materials/` | 8 | Grass, dirt, cobblestone, timber, hedge, plaster, and roof photographs wrapped over simple geometry. |
| `props/` | 4 | Individual archery target, canvas tent, hay bale, and wooden cart cutouts. |
| `pickups/` | 8 | One isolated homemade foam, PVC, cardboard, or practical-light prop per weapon. |
| `fighters/` | 40 | Five ordinary LARPer poses per weapon: idle, walk, attack, hit, and non-graphic death. |
| `viewmodels/` | 56 | Three-frame ranged actions, three bow-draw frames with no bow reload assets, and a six-pose ammo-free greatsword swing. |
| `effects/` | 6 | Individual arrow, bolt, knife, fireball, lightning, and dust-impact photographs. |
| project root | 1 | The photographic Battle Village cover image. |

The replacement fighter, pickup, prop, and cover sources were created with
OpenAI's built-in image generation tool. Prompts use the Cookout game's
awkward live-action tone: ordinary people and objects, circa-2010 iPhone 4
direct flash, deep focus, clipped highlights, imperfect auto white balance,
real pores and fabric wear, and no cinematic light, bokeh, modern HDR, plastic
skin, or AI-slick concept-art finish. Homemade weapons must visibly read as
safe foam, PVC, cardboard, tape, cellophane, or practical LEDs.

The per-asset prompt summaries and retained source paths are recorded in
[`ASSET_GENERATION.md`](ASSET_GENERATION.md).

Isolated generations use a flat chroma source and an alpha-preserving matte.
Every fighter, pickup, prop, effect, and viewmodel must contain real
transparency with clear corners and safety gutters—never a baked checkerboard,
white rectangle, floor, shadow, or halo. The eight tiled materials and the
title cover are deliberately opaque because they are surfaces and a full
background scene, not isolated cutouts.

## First-person framing

Each viewmodel is an independent 768-by-768 transparent image. Idle, attack,
reload, and bow-draw poses are genuinely photographed at a wider scale rather
than merely padded after generation. The shipped alpha silhouette keeps at
least 12 percent clear on its top, left, and right, so a sleeve or prop can
never terminate in a hard rectangular source crop. Only lower arms may leave
through the bottom; arms may not escape through a bottom-side corner. Runtime
placement follows common first-person composition: hands and props live in the
lower third or lower corners, the center aiming corridor stays readable, and
at least four percent of the viewport remains clear on the top and sides after
all sway and attack transforms. Runtime CSS adds weapon-specific recoil,
reload arcs, bow-draw movement, sway, bob, focus, and sprint motion without
combining frames into a sheet.

Sleeves, hands, and handmade prop construction are continuity-locked within a
weapon sequence. The visual-review audit renders every frame at both supported
viewport extremes and requires its meaningful lower alpha edge to continue
past the screen bottom while keeping the top and both sides clear. A manual
sequence review additionally checks these identity anchors:

| Weapon | Locked first-person identity |
| --- | --- |
| Throwing knives | Burgundy polo sleeves, matching brown leather wrist bracers, and the fighter's black/red foam knives. |
| Shortbow | Burgundy tunic sleeves, gray taped wrist guards, and one consistent white PVC practice bow. |
| Ember gauntlet | Beige undersleeve, brown bracer, and orange/silver taped glove; the gem is on the palm only, while every fire pose shows the gemless glove back. |
| Crossbow | Plum sleeves, silver-tape forearm wraps, and the same wood/cardboard crossbow in every pose. |
| Storm wand | One shade and construction of dark blue velvet bell sleeve, with the same gray PVC, blue-tape, foil-fin wand throughout. |
| Longbow | Charcoal-green sleeves, brown bracers, and one white taped longbow. |
| Greatsword | Navy sleeves, black faux-leather bracers, and one broad silver EVA blade sweeping from screen-left to screen-right. |
| Fireball tome | Mustard robe sleeves and one brown ring-binder tome; fire frames contain no detached fireball. |

### First-person animation mapping

The renderer registers 56 first-person frame slots. Every weapon uses one idle
plus its fire poses. Five charge-based ranged weapons add three reload poses;
the two ammo-free bows use three draw poses and no reload imagery. The
ammo-free greatsword uses six discrete fire poses,
giving its broad melee arc 540 ms of readable windup, impact, follow-through,
and recovery. Fire frames normally advance in 90 ms steps (about 11 fps), with
no interpolation; the rapid-fire lightning wand divides its 160 ms cadence
across all three poses so none is skipped. Reload and bow-draw frames map
evenly across their full gameplay progress.

Idle uses `${asset}-idle.webp`; ordinary actions use numbered
`${asset}-${state}-1.webp` through `-3.webp`. Greatsword fire alone continues
through `greatsword-fire-6.webp` and has no reload files. The former singular
action files were retired. Every frame was generated as its own pose and
remains an individual transparent image, not a transform-derived duplicate,
sprite sheet, or animation strip.

All `fire` images are post-spawn states. They may show a launcher, bow, wand,
or empty throwing hand, but never an arrow, bolt, thrown knife, fireball, or
detached spell effect. Fighter `attack` cutouts follow the same ownership rule:
the release/follow-through pose contains no world-owned projectile. Pre-shot
idle, reload, and bow-draw poses may still show a held or loaded prop.

### Third-person fighter animation mapping

Third-person opponents use the same deliberately simple live-action technique
as Cookout's guests: every pose is a standalone transparent photograph,
preloaded into a cache, and the sprite texture changes only when its state
changes. Cookout ships one `idle`, `hungry`, `walk`, `eat`, and `happy` image
per guest and reuses `hungry` for multiplayer attacks and `happy` for defeated
players. LARP keeps that discrete, no-tween structure but gives combat its own
unambiguous states instead of aliases.

Every weapon therefore requires exactly these five files:
`${asset}-idle.webp`, `${asset}-walk.webp`, `${asset}-attack.webp`,
`${asset}-hit.webp`, and `${asset}-death.webp`, all under `fighters/`. Across
eight weapons this is a strict 40-cutout manifest. Runtime presentation uses
the priority `death > hit > attack > walk > idle`: the authoritative `dead`
flag selects death, `flashHit` selects hit, `attackTime` selects attack, and
horizontal movement selects walk. The dedicated death image is a readable,
non-graphic pose that stays visible through the 2.15-second practice take-end
(and until the authoritative online reset) instead of disappearing on the
damage frame. Gameplay health, collision, and hit authority remain unchanged.

## World sprites and projectiles

Fighter cutouts always aim toward the camera so a head-on opponent visibly
attacks forward. Each weapon swaps to a distinct fighter image. The renderer
uses camera-facing sprites for people and pickups.

Arrows, crossbow bolts, and throwing knives are not generic particles. Each is
an individual transparent photograph on a plane mesh. The mesh's local
horizontal axis is aligned to its actual 3D travel vector every frame while
its plane normal remains camera-readable. Fireballs move through the same
spatial world with server-authoritative gameplay simulation.

Shipped cutouts are downsampled, alpha-preserving WebP files. This retains the
deliberately low-resolution phone-photo character while keeping the runtime
raster payload compact.
