// One target profile is shared by practice traces and multiplayer authority so
// the photographed opponent is hittable in the same place in both modes.
export const CHARACTER_HITBOX = Object.freeze({
  body: Object.freeze({ offsetY: 0.96, radius: 0.68 }),
  head: Object.freeze({ offsetY: 1.75, radius: 0.38 }),
});
