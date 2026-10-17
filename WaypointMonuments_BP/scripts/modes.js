// Waypoint modes are driven purely by the block directly beneath the monument.
// Placing or removing that activator block switches the mode; nothing is
// stored that could go stale.

export const MODE_NONE = "none";
export const MODE_TELEPORT = "teleport";
export const MODE_ENCHANT = "enchant";
export const MODE_WARD = "ward";

export const MODE_STATE = "wp:mode";

// Activator block -> mode. Add an entry here to introduce a new waypoint mode
// (and a matching value in the block's wp:mode state).
export const ACTIVATORS = {
  "minecraft:redstone_block": MODE_TELEPORT,
  "minecraft:lapis_block": MODE_ENCHANT,
  "minecraft:diamond_block": MODE_WARD
};

export const MODE_LABELS = {
  [MODE_NONE]: "Dormant",
  [MODE_TELEPORT]: "Teleport Waypoint",
  [MODE_ENCHANT]: "Enchanting Waypoint",
  [MODE_WARD]: "Sanctuary Waypoint"
};

// Chat colour code used when announcing each mode.
export const MODE_COLORS = {
  [MODE_NONE]: "§7",
  [MODE_TELEPORT]: "§c",
  [MODE_ENCHANT]: "§9",
  [MODE_WARD]: "§b"
};

// The Sanctuary mode is deliberately invisible: no particles, and the block
// keeps its dormant look (no permutation for "ward" in the block JSON).
const MODE_PARTICLES = {
  [MODE_TELEPORT]: { effect: "wp:redstone_spark", offset: { x: 0.5, y: 1.05, z: 0.5 } },
  [MODE_ENCHANT]: { effect: "wp:lapis_halo", offset: { x: 0.5, y: 0.45, z: 0.5 } }
};

const PARTICLE_VIEW_DISTANCE = 48;

// Reads the activator beneath the given waypoint block. Returns MODE_NONE
// when the block below is missing, unloaded, or not an activator.
export function detectMode(block) {
  let below;
  try {
    below = block.below(1);
  } catch {
    below = undefined;
  }
  if (!below) return MODE_NONE;
  return ACTIVATORS[below.typeId] ?? MODE_NONE;
}

export function getBlockMode(block) {
  try {
    const state = block.permutation.getState(MODE_STATE);
    return typeof state === "string" ? state : MODE_NONE;
  } catch {
    return MODE_NONE;
  }
}

// Brings the block's visual state in line with the activator beneath it.
// Returns the current mode, and whether it changed.
export function syncBlockMode(block) {
  const mode = detectMode(block);
  const current = getBlockMode(block);
  if (current === mode) return { mode, changed: false };
  try {
    block.setPermutation(block.permutation.withState(MODE_STATE, mode));
  } catch {
    return { mode, changed: false };
  }
  return { mode, changed: true, previous: current };
}

// Emits the ambient effect for the block's mode, but only when someone is
// close enough to see it.
export function spawnModeParticles(block, mode) {
  const spec = MODE_PARTICLES[mode];
  if (!spec) return;
  const loc = block.location;
  const center = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
  try {
    const viewers = block.dimension.getPlayers({ location: center, maxDistance: PARTICLE_VIEW_DISTANCE });
    if (viewers.length === 0) return;
    block.dimension.spawnParticle(spec.effect, {
      x: loc.x + spec.offset.x,
      y: loc.y + spec.offset.y,
      z: loc.z + spec.offset.z
    });
  } catch {}
}
