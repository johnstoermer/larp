# Generated asset provenance

The August 2026 visual overhaul used OpenAI's built-in `imagegen` tool through
the local imagegen skill. No CLI generation fallback was used. The final
generation family asked for awkward but realistic circa-2010 iPhone 4 direct
flash, deep focus, imperfect white balance, mild sensor noise and JPEG crunch,
ordinary heavier LARP hobbyists, and visibly homemade foam/PVC/cardboard/tape
props. It explicitly rejected cinematic light, bokeh, modern HDR, plastic
skin, concept-art polish, malformed anatomy, duplicated objects, text, logos,
floor planes, cast shadows, and clipped silhouettes.

Isolated subjects were generated or corrected against uniform chroma green,
then converted to real-alpha WebP cutouts with the imagegen skill's bundled
`remove_chroma_key.py` helper, soft mattes, and despill. The title cover is the
one full-scene generation and is intentionally opaque. Generated source PNGs
remain in the local paths below; shipped runtime files live under
`public/assets/larp/`.

## Final source manifest

| Runtime output | Short prompt summary | Retained built-in source |
| --- | --- | --- |
| `cover.webp` | Four sincere, ordinary backyard LARPers with cardboard battlement and pop-up tents, awkward direct flash, full 16:9 scene. | `/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/exec-53397a86-535c-46b2-94f4-ab0e252d617c.png` |
| `fighters/throwing-knives-idle.webp` | Stocky middle-aged glasses-and-mustache hobbyist in cargo shorts, holding two blunt foam knives. | `/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/exec-092309af-78e2-46f7-9a24-b18daff41fb4.png` |
| `fighters/shortbow-idle.webp` | Plus-size bespectacled woman with a taped white PVC bow, foam arrow, and cardboard quiver. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-251aa1ee-a54f-44bc-b138-070567aff54c.png` |
| `fighters/ember-gauntlet-idle.webp` | Heavy bespectacled hobbyist in a thrifted robe/hoodie costume, presenting a cardboard LED gauntlet. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-eb6b3574-e4aa-4abe-bb6b-e387ae1d554b.png` |
| `fighters/crossbow-idle.webp` | Stocky bespectacled woman aiming a safe cardboard/PVC crossbow with a blunt foam bolt. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-add6442f-899a-488e-94f6-abe7b3b442e6.png` |
| `fighters/lightning-wand-idle.webp` | Stout bespectacled hobbyist in a bathrobe costume with a taped PVC/foil LED wand. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-96ce6320-0236-4bfa-bac3-a763a96435d1.png` |
| `fighters/longbow-idle.webp` | Heavy older woman in glasses, cardigan, felt tabard, and curtain cape with a safe taped bow. | `/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/exec-21944df7-ef59-4155-9d88-0c9e3b9c85fb.png` |
| `fighters/greatsword-idle.webp` | Heavy glasses-wearing hobbyist in craft-foam scale armor with an oversized silver foam sword. | `/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/exec-e0823e55-cd78-4ff4-8803-5d9955c278f9.png` |
| `fighters/fireball-tome-idle.webp` | Heavy middle-aged bespectacled caster with a battered binder and orange cellophane LED craft ball. | `/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/exec-78ff76be-1f25-4310-8107-3a25900112dd.png` |
| `pickups/throwing-knives.webp` | Exactly two scuffed black EVA knives with wrinkled red duct-tape grips. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-ede3981c-f1b6-4d42-aae4-bfc1aca9a9fa.png` |
| `pickups/shortbow.webp` | One taped white PVC bow and one dowel arrow with an oversized blunt foam tip. | `/Users/johnstoermer/.codex/generated_images/01a04e73-75aa-7582-845e-5aaf050c30bf/exec-b2015970-fa8a-4b2d-95ef-bc9084e4d3be.png` |
| `pickups/ember-gauntlet.webp` | One empty corrugated-cardboard glove with orange/silver tape and a weak practical LED. | `/Users/johnstoermer/.codex/generated_images/01a04e73-75aa-7582-845e-5aaf050c30bf/exec-831f976d-70b9-4abc-9d77-ba0d405ad554.png` |
| `pickups/crossbow.webp` | One mechanically legible cardboard/PVC crossbow with a single centered string path and seated blunt bolt. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-c76a69e3-4212-408c-8c9a-081b013809c4.png` |
| `pickups/lightning-wand.webp` | One blue-taped PVC/foil/cardboard wand with weak blue practical LEDs. | `/Users/johnstoermer/.codex/generated_images/01a04e73-75aa-7582-845e-5aaf050c30bf/exec-3b680d7b-dcce-4907-b5a5-9befd536a3c0.png` |
| `pickups/longbow.webp` | One bent plywood/PVC bow and one dowel arrow with red tape fletching and blunt foam tip. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-bb29f3fc-d178-4009-b520-00ffe624853e.png` |
| `pickups/greatsword.webp` | One oversized rounded silver-painted EVA sword with duct-tape crossguard and grip. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-0a274d6e-b997-43f7-9f9d-f054920b620d.png` |
| `pickups/fireball-tome.webp` | One battered office binder disguised with faux leather plus one orange cellophane LED ball. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-6efab81c-34a0-40ce-bc7e-e0bf8eb947db.png` |
| `props/hay-bales.webp` | Exactly three ordinary rectangular hay bales, stacked cleanly as a complete cutout. | `/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/exec-c5229e28-1008-4dd4-8b24-a56c51ce87b4.png` |
| `props/wooden-cart.webp` | Plausible weathered two-wheel hand cart: continuous axle, two visible hubs, and two separate open shafts. | `/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/exec-5ec2c3fb-dab8-4025-ae8e-e4d124ec602c.png` |
| `war/tree.webp` | One complete, roughly radial deciduous tree with full trunk and canopy, direct-flash 2010 phone-photo texture, isolated and re-padded for crossed planes. | `/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/exec-b7ee5519-284d-4bd7-8a6f-1cedaf85c24d.png` |
| `war/bush.webp` | One complete, roughly radial scrub bush, direct-flash 2010 phone-photo texture, isolated and re-padded for crossed planes. | `/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/exec-3b95f8fd-af5c-4893-9ccc-6b75a942c348.png` |

## First-person sequences

Every shipped first-person frame below came from its own imagegen call. None
is a translated, rotated, or warped copy of another frame. Fire frames are
post-spawn and omit detached projectiles; held ammunition appears only in
idle, reload, or bow-draw states. All final cutouts are 768-by-768 alpha WebPs
with a 12% top/side framing gate.

### Throwing knives, shortbow, and ember gauntlet

These retained sources are under
`/Users/johnstoermer/.codex/generated_images/01a04e73-75aa-7582-845e-5aaf050c30bf/`.

| Runtime output | Pose | Source PNG |
| --- | --- | --- |
| `viewmodels/throwing-knives-idle.webp` | Compact two-knife ready. | `exec-b58108d7-caee-4fd7-9d13-582017c5a03c.png` |
| `viewmodels/throwing-knives-fire-1.webp` | Post-shot open throwing hand; one off-hand knife. | `exec-6c306eca-0a21-4d0d-bb95-0a8bc3d0859d.png` |
| `viewmodels/throwing-knives-fire-2.webp` | Empty-hand follow-through. | `exec-4fde60d9-8d85-4536-add9-e18e713432da.png` |
| `viewmodels/throwing-knives-fire-3.webp` | Empty-hand recovery. | `exec-4ab3eb5d-e913-4643-9a62-b8ab20d128f7.png` |
| `viewmodels/throwing-knives-reload-1.webp` | Inspect two safe foam knives. | `exec-fd1262fd-fa06-45ed-b627-61b388521a5b.png` |
| `viewmodels/throwing-knives-reload-2.webp` | Two-knife manipulation. | `exec-ffbdaea0-6419-41af-9f70-ef2f2987040f.png` |
| `viewmodels/throwing-knives-reload-3.webp` | Settle both knives ready. | `exec-cd27c13c-a2cc-411e-a55b-c7a6679fd3fb.png` |
| `viewmodels/shortbow-idle.webp` | Compact bow and loose blunt arrow. | `exec-c77ae837-b1a9-475c-82d1-a2e13b06da4d.png` |
| `viewmodels/shortbow-fire-1.webp` | Released string; no arrow. | `exec-c4539ffd-5fdd-4ea4-8593-390184e56930.png` |
| `viewmodels/shortbow-fire-2.webp` | Empty-hand follow-through; no arrow. | `exec-833d1a60-053e-423d-9b61-13e17d4937e9.png` |
| `viewmodels/shortbow-fire-3.webp` | Lower recovery; no arrow. | `exec-0abff900-39a7-4e97-9dc4-9e069a201d25.png` |
| `viewmodels/shortbow-draw-1.webp` | Nock with little tension. | `exec-f1ac990d-0e5e-4963-a96b-099c8d200b9b.png` |
| `viewmodels/shortbow-draw-2.webp` | Half draw. | `exec-d5aa2717-686c-46b9-b3cf-6b34020d478a.png` |
| `viewmodels/shortbow-draw-3.webp` | Full draw. | `exec-509f8dc4-3de3-4b2e-aaf4-efc91c70164b.png` |
| `viewmodels/ember-gauntlet-idle.webp` | Relaxed practical-LED gauntlet. | `exec-40c358cc-9c9b-4142-91b0-129857ddbeeb.png` |
| `viewmodels/ember-gauntlet-fire-1.webp` | Curl/anticipation with practical LED only. | `exec-463b4b48-519b-47b3-a688-cadfb8df9a01.png` |
| `viewmodels/ember-gauntlet-fire-2.webp` | Open action palm; no detached effect. | `exec-9abfab22-518c-43d2-b126-b151abde0327.png` |
| `viewmodels/ember-gauntlet-fire-3.webp` | Lower recovery. | `exec-aed821ac-393c-402a-a9b4-3db328f30080.png` |
| `viewmodels/ember-gauntlet-reload-1.webp` | Expose battery flap/switch. | `exec-59550b15-cbaf-46db-8935-09d126bea23c.png` |
| `viewmodels/ember-gauntlet-reload-2.webp` | Manipulate physical switch. | `exec-ce612a5d-d739-4217-afba-0f5f17ba795e.png` |
| `viewmodels/ember-gauntlet-reload-3.webp` | Close and settle gauntlet. | `exec-342d925c-af45-46c8-ab4b-61aab1ec735f.png` |

### Greatsword and fireball tome

These retained sources are under
`/Users/johnstoermer/.codex/generated_images/01a04e6a-e526-74d1-9fd7-26448d270181/`.

| Runtime output | Pose | Source PNG |
| --- | --- | --- |
| `viewmodels/greatsword-idle.webp` | Low two-handed ready. | `exec-0e1b9b2e-c1fd-4cfa-be01-7f8d9dae7376.png` |
| `viewmodels/greatsword-fire-1.webp` | Raised windup. | `exec-b4a08820-252c-4f95-864d-38dfca032f67.png` |
| `viewmodels/greatsword-fire-2.webp` | Zoomed-out early acceleration. | `exec-307439ba-7ca8-4c4a-9ac3-0d743894e539.png` |
| `viewmodels/greatsword-fire-3.webp` | Zoomed-out cross-body mid-swing. | `exec-fa98d7e1-79f6-4944-b067-a737140a85f2.png` |
| `viewmodels/greatsword-fire-4.webp` | Broad impact/contact pose. | `exec-206e8ca7-94ec-44e3-ae65-7b4c1fee6b1d.png` |
| `viewmodels/greatsword-fire-5.webp` | Diagonal follow-through. | `exec-58fba62b-069c-43fe-ad7b-552c119f97e5.png` |
| `viewmodels/greatsword-fire-6.webp` | Low recovery. | `exec-41bca346-3bea-41b1-8023-13951e466227.png` |
| `viewmodels/fireball-tome-idle.webp` | Binder and physical cellophane LED ball ready. | `exec-91bd9357-772d-47d5-80e9-321752684e8d.png` |
| `viewmodels/fireball-tome-fire-1.webp` | Empty-palm immediate post-release. | `exec-719bc07c-ed36-47bf-a92c-50e3bd2c980c.png` |
| `viewmodels/fireball-tome-fire-2.webp` | Empty-palm follow-through. | `exec-f5ca675b-f9df-4005-93b3-07a19be26b6f.png` |
| `viewmodels/fireball-tome-fire-3.webp` | Empty-hand recovery. | `exec-0a5fe236-e0e3-43d5-898a-5d0b52fa19cb.png` |
| `viewmodels/fireball-tome-reload-1.webp` | Reach into binder supply pouch. | `exec-9484f2df-2c4f-4509-933c-3a8711b75c8b.png` |
| `viewmodels/fireball-tome-reload-2.webp` | Lift replacement craft ball. | `exec-bd7b60cf-ae39-487f-b64d-e09c238b706c.png` |
| `viewmodels/fireball-tome-reload-3.webp` | Settle physical craft ball ready. | `exec-4eb27add-4cff-4962-b630-1b127cfca42a.png` |

## Third-person fighter states

The initial 16 independently generated action-pose sources are retained under
`/Users/johnstoermer/.codex/generated_images/01a04e73-4ec8-7ac2-8650-0617f425cdac/`.
Each matching `-idle.webp` is a byte-identical copy of the corresponding base
fighter source listed in the main manifest.

| Fighter action outputs | Source PNGs in walk / attack / hit / death order |
| --- | --- |
| `throwing-knives-*` | `exec-b309f85c-a103-4b1e-aa6a-6e5500c1abde.png`; `exec-1edfa68f-0525-4de8-a16e-d0a304706445.png`; `exec-3eb01ae0-92f5-4f23-a7f0-b8f5b2f9a975.png`; `exec-c2f10f60-6a14-41d9-ac82-4c79ef4d9319.png` |
| `shortbow-*` | `exec-ee8501e3-3025-4de7-b85f-5006c42bafb7.png`; `exec-f091f486-ca6d-439b-80c0-212cacca1204.png`; `exec-fde3e894-00de-48b5-8294-511593ef376f.png`; `exec-ca421597-a976-4f13-b350-cfb3638da5ea.png` |
| `ember-gauntlet-*` | `exec-5922c4de-8504-4178-9dfb-d9f074a7401d.png`; `exec-8fa3c990-c3db-4735-86c1-144463306efc.png`; `exec-a922dc17-116b-48bb-bb4a-e1517f13066b.png`; `exec-c78fffc8-4336-4cd1-935b-9a9d000dee2f.png` |
| `crossbow-*` | `exec-105be23b-d4e0-486c-be1d-4db24f6dab19.png`; `exec-c4116d55-6f0d-4b99-99e6-a3ca59896619.png`; `exec-044f6a9d-18c2-49f1-ab39-7aa3ae142d9e.png`; `exec-c5d7365e-2bf8-4ede-81fb-17ffa9bf0f0a.png` |

The attack entries in that first fighter batch were subsequently regenerated
where necessary to remove any world-owned projectile; the final replacement
source paths are recorded in the continuation below.

## First-person continuation: crossbow, lightning wand, and longbow

Every frame in these three sequences is an independent built-in imagegen
generation. Crossbow and longbow sources are retained under
`/Users/johnstoermer/.codex/generated_images/01a04e73-1480-7363-a5e6-8bb3d9ce2210/`;
lightning-wand sources are retained under
`/Users/johnstoermer/.codex/generated_images/01a04ebb-05db-7fb3-b5f7-d53e8184266b/`.
All fire poses occur after the world-owned shot/effect spawns: crossbow and
longbow fire frames contain no bolt or arrow, and lightning-wand fire frames
contain only the physical wand and its three practical LEDs.

| Runtime output | Pose | Source PNG |
| --- | --- | --- |
| `viewmodels/crossbow-idle.webp` | Loaded cardboard/PVC crossbow with one seated blunt foam bolt. | `exec-df5e0691-df2a-4f39-988a-06701e451971.png` |
| `viewmodels/crossbow-fire-1.webp` | Immediate post-shot recoil; empty rail. | `exec-695b20e1-3f1e-4846-bf73-40c7ae712d0a.png` |
| `viewmodels/crossbow-fire-2.webp` | Mid-recoil rise; empty rail. | `exec-3831a6f1-c760-45ac-9dfa-a5ec35a31746.png` |
| `viewmodels/crossbow-fire-3.webp` | Settling recovery; empty rail. | `exec-8337f216-c150-419d-9906-92fcd782e583.png` |
| `viewmodels/crossbow-reload-1.webp` | Present the sole blunt bolt beside the empty crossbow. | `exec-27ac38dc-1f28-458c-a165-a2ec79011d28.png` |
| `viewmodels/crossbow-reload-2.webp` | Align the sole bolt over the rail. | `exec-e7c8e5c4-2769-49fc-a3a9-53da29361e02.png` |
| `viewmodels/crossbow-reload-3.webp` | Seat the sole bolt ready. | `exec-5f7e72f2-1341-4e62-95fb-6fa3916b66ce.png` |
| `viewmodels/lightning-wand-idle.webp` | Compact two-handed ready with physical LEDs. | `exec-408ed220-49a3-4364-b53e-c8f387f468bd.png` |
| `viewmodels/lightning-wand-fire-1.webp` | Diagonal post-cast thrust; no detached effect. | `exec-f4494baf-b400-4856-8fd2-f865701c0e20.png` |
| `viewmodels/lightning-wand-fire-2.webp` | Raised post-cast recoil; no detached effect. | `exec-669bc9eb-5b71-45b3-8aff-153c3b58db08.png` |
| `viewmodels/lightning-wand-fire-3.webp` | Upright settling pose; no detached effect. | `exec-2990501f-f406-4160-bcb1-dc023e7fb9d4.png` |
| `viewmodels/lightning-wand-reload-1.webp` | Peel back the blue-tape battery flap. | `exec-d0cd3273-5eba-4024-a7d0-802929b4e564.png` |
| `viewmodels/lightning-wand-reload-2.webp` | Expose and manipulate the physical battery switch. | `exec-88742759-3929-4758-9c21-8375ae900667.png` |
| `viewmodels/lightning-wand-reload-3.webp` | Close and settle the taped grip. | `exec-aaba8331-d734-475f-ba72-8c4d9f413dad.png` |
| `viewmodels/longbow-idle.webp` | Resting homemade bow with one blunt arrow. | `exec-481608f3-7e31-4fce-ab7d-e668aaf62627.png` |
| `viewmodels/longbow-draw-1.webp` | Shallow draw with one nocked arrow and a single V-shaped string. | `exec-3d49a09a-8e9b-4c87-821d-fb2aeab567af.png` |
| `viewmodels/longbow-draw-2.webp` | Mid draw with deeper string tension. | `exec-8aadcbd0-bce4-4472-8288-2c2aed961955.png` |
| `viewmodels/longbow-draw-3.webp` | Full draw immediately before release. | `exec-62ff7d5b-fdb5-4f6f-9726-a53b5110b924.png` |
| `viewmodels/longbow-fire-1.webp` | Immediate post-release recoil; no arrow. | `exec-0aa6d37d-b0b1-4ea5-b07c-221b1384e78d.png` |
| `viewmodels/longbow-fire-2.webp` | Peak empty-bow recoil; no arrow. | `exec-dcb75537-c53e-43bb-9c05-b42057b8c473.png` |
| `viewmodels/longbow-fire-3.webp` | Empty-bow recovery; no arrow. | `exec-4f6df782-bff2-44d1-b651-e26d51cba7ce.png` |

The 24 accepted sources are genuine square generations with at least 12% empty
space at the left, right, and top before processing. Each was resized to
600-by-600, centered on a 768-by-768 green canvas, and converted with the
bundled chroma-key helper using soft matte, despill, thresholds 55/220, and a
border-derived key. The shipped results are 24 unique 768-by-768 alpha WebPs
with fully transparent outer borders.

## Fighter continuation and projectile-free attack replacements

The remaining four fighter sequences and the three corrected ranged attack
poses below were independently generated with built-in imagegen. Their sources
are retained under
`/Users/johnstoermer/.codex/generated_images/01a04e73-75aa-7582-845e-5aaf050c30bf/`.
The corrected attacks supersede their first-batch candidates: the throwing
hand is empty, each bow/crossbow is visibly unloaded, and magic users show only
their attached practical prop lights. The rejected crossbow candidate
`exec-f64152bc-d8ac-4a52-b54c-0f281510eea0.png` was not shipped because its
top rail could still be read as carrying a pale foam bolt.

| Runtime output | Pose | Source PNG |
| --- | --- | --- |
| `fighters/throwing-knives-attack.webp` | Post-throw reach with an empty throwing hand and one held off-hand knife. | `exec-5bd15f0f-2ce3-4a41-8a05-d633829e0030.png` |
| `fighters/shortbow-attack.webp` | Released bow and empty draw hand; no arrow. | `exec-5cf16b7c-3321-478f-8c5b-64aefc659836.png` |
| `fighters/crossbow-attack.webp` | Post-shot aim with a clearly empty rail. | `exec-097ea09f-28c6-4de3-8388-41e90752621a.png` |
| `fighters/lightning-wand-walk.webp` | Clear mid-stride practical-wand pose. | `exec-3afd0ffb-cb9d-4f70-b931-335406ce5ebb.png` |
| `fighters/lightning-wand-attack.webp` | Post-cast wand extension with no detached electrical effect. | `exec-4ad3e9e9-4d26-45e5-a5fe-8ab66c0870b4.png` |
| `fighters/lightning-wand-hit.webp` | Readable recoil while retaining the wand. | `exec-6a7b1398-8eb5-44ba-8ff1-a7d77408924a.png` |
| `fighters/lightning-wand-death.webp` | Non-graphic kneeling collapse. | `exec-9b99e85f-f1ab-414c-be90-a7cfc9793f63.png` |
| `fighters/longbow-walk.webp` | Clear mid-stride bow-carry pose. | `exec-f24beefa-6280-4278-8989-a206bcc520fd.png` |
| `fighters/longbow-attack.webp` | Released bow and empty draw hand; no arrow. | `exec-a8f88abe-46c2-47a5-b7c0-3ef27cf34513.png` |
| `fighters/longbow-hit.webp` | Readable recoil while retaining the bow. | `exec-83653a3a-0232-406a-8b91-084c91f6378a.png` |
| `fighters/longbow-death.webp` | Non-graphic kneeling collapse. | `exec-47ee9b53-319a-4412-8ebe-789bbd1735a5.png` |
| `fighters/greatsword-walk.webp` | Clear mid-stride two-hand carry. | `exec-afcafdcd-76f7-4de1-9ccc-9c4e078c6c28.png` |
| `fighters/greatsword-attack.webp` | Broad two-hand melee follow-through. | `exec-e72a6d1a-1b6c-4bb2-952a-a2e202cba318.png` |
| `fighters/greatsword-hit.webp` | Readable recoil while retaining the foam sword. | `exec-ebd1a4a8-6dc3-4f0f-a707-acc9d3c26737.png` |
| `fighters/greatsword-death.webp` | Non-graphic kneeling collapse. | `exec-10b64262-c7cc-4fb4-99d7-1c210f7364f0.png` |
| `fighters/fireball-tome-walk.webp` | Clear mid-stride tome-carry pose. | `exec-1d013c14-27cd-453b-94fe-7a41a57724dc.png` |
| `fighters/fireball-tome-attack.webp` | Empty-hand post-cast reach; no fireball. | `exec-72c0b003-c83d-46ee-8fd2-683ac2cfca2d.png` |
| `fighters/fireball-tome-hit.webp` | Readable recoil while retaining the tome. | `exec-49a7068f-cf40-4558-bedf-59af07b6b5da.png` |
| `fighters/fireball-tome-death.webp` | Non-graphic kneeling collapse. | `exec-4233cf86-99da-464d-bc97-5037586cfa03.png` |

The four matching idle files are byte-identical canonical copies of the
fighter sources listed in the main manifest. All 23 files in this lane fit
complete silhouettes into 512-by-768 alpha WebPs: outer-edge alpha is zero,
the minimum horizontal gutter is 51 pixels, the minimum vertical gutter is 61
pixels, and every output has a unique SHA-256 hash.

## Live-play continuity correction pass

The following retained sources supersede the earlier first-person entries for
throwing knives, shortbow, and lightning wand. Each sequence used one accepted
idle image as an immutable continuity master. Imagegen was asked to change only
the action pose while preserving the same hands, skin, sleeve fabric and cuff,
bracers, and homemade prop. Fire frames explicitly exclude any detached world
projectile or magical effect. The final PNGs have true alpha and were imported
as 768-by-768 WebPs without stretching; the knife set was additionally scaled
to 82% and bottom-anchored to clear the 12% side-framing gate.

| Runtime sequence | Locked visual continuity | Retained built-in sources |
| --- | --- | --- |
| `viewmodels/throwing-knives-*` | Burgundy polo sleeves; brown left bracer; black-and-gray taped right bracer; matching black foam/red-tape knives. | `/Users/johnstoermer/.codex/generated_images/01a04f1f-7636-7fb2-9b53-246db2cacbb6/retained-throwing-knives-{idle,fire-1,fire-2,fire-3,reload-1,reload-2,reload-3}-transparent.png` |
| `viewmodels/shortbow-*` | Burgundy thrift tunic with gold cuff stitching; silver duct-tape guards; white taped PVC bow and orange cord. | `/Users/johnstoermer/.codex/generated_images/01a04f1f-88c7-7870-aceb-8d5b7985e931/shortbow-{idle,draw-1,draw-2,draw-3,fire-1,fire-2,fire-3}-candidate.png` |
| `viewmodels/ember-gauntlet-*` | Beige tunic undersleeves; dark-brown buckled bracers; brown craft-foam glove with orange and silver tape. | `/Users/johnstoermer/.codex/generated_images/01a04e73-75aa-7582-845e-5aaf050c30bf/ember-gauntlet-{idle,fire-1,fire-2,fire-3,reload-1,reload-2,reload-3}-beige-alpha.png` |
| `viewmodels/lightning-wand-*` | Midnight-blue velvet sleeves with narrow self-bound cuffs; warm-tan hands; one gray/blue taped wand with three LEDs and four foil fins. | `/Users/johnstoermer/.codex/generated_images/01a04f1f-7636-7fb2-9b53-246db2cacbb6/retained-lightning-wand-idle-transparent.png`; same directory `retained3-lightning-wand-{fire-1,fire-2,fire-3,reload-1,reload-2,reload-3}-transparent.png` |
| `viewmodels/greatsword-*` | Navy tee sleeves; black faux-leather bracers; one broad silver EVA-foam sword in a two-handed left-to-right sweep. | `/Users/johnstoermer/.codex/generated_images/01a04f1f-88c7-7870-aceb-8d5b7985e931/greatsword-{idle,fire-1,fire-2,fire-3,fire-4,fire-5,fire-6}-candidate.png` |

`viewmodels/shortbow-draw-3.webp` received one later precise-object correction
using `shortbow-draw-2.webp` as the construction reference. Imagegen was asked
to preserve the full-draw pose and continuity master while moving the black
blunt foam tip from the rear/draw-hand end to the forward/bow-side end of the
single attached arrow. The accepted built-in source used a flat chroma field
and is retained at
`/Users/johnstoermer/.codex/generated_images/01a04f92-f693-77f2-9be3-ce205c00fd01/exec-58f8eda3-8750-4546-b0ab-9610959c3391.png`;
its soft-matted alpha source is retained beside it as
`shortbow-draw-3-tip-fixed-alpha.png`.

The shortbow is intentionally ammo-free at runtime and has no reload frames.
Its three draw poses retain one attached blunt arrow; all three fire poses are
post-release and contain no arrow. Lightning fire poses contain only physical
hand recoil around the retained wand, with no bolt, glow, or detached effect.
The ember gem is physically mounted on the palm: it is visible in ready/reload
poses, while every post-release fire pose shows the gemless back of the glove.
Throwing knives are also ammo-free at runtime: holding primary fire repeats the
three fire poses once per second, and the retained reload photographs are never
registered by the viewmodel controller.
The greatsword sequence is ammo-free and projectile-free. Its six photographs
stage a far-left windup, center crossing/contact, and far-right follow-through;
the runtime adds a matching monotonic screen-space sweep instead of gun recoil.
