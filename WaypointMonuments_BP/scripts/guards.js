import { world, system } from "@minecraft/server";

// Village Guards: pillager-looking defenders with a green banner on their back.
// They spawn once per village, never sleep, and fight every hostile mob.
// A fletching table next to a guard turns it into an archer, a grindstone
// turns it back into a melee fighter.
export const GUARD_CONFIG = {
  typeId: "wp:village_guard",
  villagerId: "minecraft:villager_v2",
  spawn: {
    minVillagers: 3,        // this many villagers nearby count as a village
    villagerRadius: 48,
    guardsPerVillagers: 3,  // one guard per this many villagers...
    minGuards: 1,
    maxGuards: 10,
    cellSize: 64,           // villages are identified by this coarse grid cell
    scanIntervalTicks: 200,
    spawnSpread: 6
  },
  station: {
    fletchingTable: "minecraft:fletching_table",
    grindstone: "minecraft:grindstone",
    radius: 3,              // blocks searched around the guard, per axis
    height: 2,
    checkIntervalTicks: 100
  },
  leash: {
    maxDistance: 64,        // wander further than this from home and walk back
    checkIntervalTicks: 200
  },
  weapons: {
    melee: "minecraft:iron_axe",
    ranged: "minecraft:bow"
  }
};

const VILLAGES_PROP = "wp:guard_villages";
const P = {
  home: "wp:g_home",
  mode: "wp:g_mode"
};

export function initGuards() {
  const cfg = GUARD_CONFIG;
  let elapsed = 0;
  system.runInterval(() => {
    elapsed += 20;
    try {
      if (elapsed % cfg.spawn.scanIntervalTicks === 0) villageScan();
    } catch {}
    try {
      if (elapsed % cfg.station.checkIntervalTicks === 0) guardUpkeep(elapsed);
    } catch {}
  }, 20);
}

// ---------------------------------------------------------------------------
// Village bookkeeping — one entry per coarse grid cell that has been stocked.
// ---------------------------------------------------------------------------

function loadVillages() {
  try {
    const raw = world.getDynamicProperty(VILLAGES_PROP);
    if (typeof raw === "string") {
      const v = JSON.parse(raw);
      if (v && typeof v === "object") return v;
    }
  } catch {}
  return {};
}

function saveVillages(map) {
  try {
    world.setDynamicProperty(VILLAGES_PROP, JSON.stringify(map));
  } catch {}
}

function cellKey(dimId, loc) {
  const s = GUARD_CONFIG.spawn.cellSize;
  return `${dimId}|${Math.floor(loc.x / s)},${Math.floor(loc.z / s)}`;
}

function villageScan() {
  const cfg = GUARD_CONFIG.spawn;
  let players;
  try {
    players = world.getAllPlayers();
  } catch {
    return;
  }
  for (const player of players) {
    try {
      const dim = player.dimension;
      const villagers = dim.getEntities({
        type: GUARD_CONFIG.villagerId,
        location: player.location,
        maxDistance: cfg.villagerRadius
      });
      if (villagers.length < cfg.minVillagers) continue;

      // The village centre is the villagers' average position, snapped to a grid
      // so the same village is recognised again on a later visit.
      let sx = 0, sy = 0, sz = 0;
      for (const v of villagers) {
        sx += v.location.x;
        sy += v.location.y;
        sz += v.location.z;
      }
      const centre = { x: sx / villagers.length, y: sy / villagers.length, z: sz / villagers.length };
      const key = cellKey(dim.id, centre);

      const villages = loadVillages();
      const wanted = Math.min(cfg.maxGuards, Math.max(cfg.minGuards, Math.round(villagers.length / cfg.guardsPerVillagers)));
      const existing = dim.getEntities({ type: GUARD_CONFIG.typeId, location: centre, maxDistance: cfg.villagerRadius }).length;
      const record = villages[key];

      // Stock a village once; afterwards only replace guards that died.
      const target = record ? Math.max(record.n, wanted) : wanted;
      if (existing >= target) {
        if (!record || record.n !== target) {
          villages[key] = { n: target, x: Math.floor(centre.x), y: Math.floor(centre.y), z: Math.floor(centre.z) };
          saveVillages(villages);
        }
        continue;
      }

      let spawned = 0;
      for (let i = existing; i < target; i++) {
        if (spawnGuard(dim, centre)) spawned++;
      }
      if (spawned > 0) {
        villages[key] = { n: target, x: Math.floor(centre.x), y: Math.floor(centre.y), z: Math.floor(centre.z) };
        saveVillages(villages);
      }
    } catch {}
  }
}

function spawnGuard(dim, centre) {
  const cfg = GUARD_CONFIG.spawn;
  for (let attempt = 0; attempt < 10; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * cfg.spawnSpread + 2;
    const x = Math.floor(centre.x + Math.cos(angle) * r);
    const z = Math.floor(centre.z + Math.sin(angle) * r);
    const spot = findGround(dim, x, Math.floor(centre.y), z);
    if (!spot) continue;
    try {
      const guard = dim.spawnEntity(GUARD_CONFIG.typeId, spot);
      guard.setDynamicProperty(P.home, JSON.stringify({ x: Math.floor(centre.x), y: Math.floor(centre.y), z: Math.floor(centre.z) }));
      applyStation(guard, "melee", true);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// Looks for standing room within +-6 blocks of the given height.
function findGround(dim, x, y, z) {
  for (let dy = 6; dy >= -6; dy--) {
    const yy = y + dy;
    let floor, feet, head;
    try {
      floor = dim.getBlock({ x, y: yy - 1, z });
      feet = dim.getBlock({ x, y: yy, z });
      head = dim.getBlock({ x, y: yy + 1, z });
    } catch {
      continue;
    }
    if (!floor || !feet || !head) continue;
    if (floor.isAir || floor.isLiquid) continue;
    if (!feet.isAir || !head.isAir) continue;
    return { x: x + 0.5, y: yy, z: z + 0.5 };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Stations and leashing
// ---------------------------------------------------------------------------

function nearbyStation(guard) {
  const cfg = GUARD_CONFIG.station;
  const dim = guard.dimension;
  const bx = Math.floor(guard.location.x);
  const by = Math.floor(guard.location.y);
  const bz = Math.floor(guard.location.z);
  let found;
  for (let dy = -1; dy <= cfg.height && !found; dy++) {
    for (let dx = -cfg.radius; dx <= cfg.radius && !found; dx++) {
      for (let dz = -cfg.radius; dz <= cfg.radius; dz++) {
        let block;
        try {
          block = dim.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
        } catch {
          continue;
        }
        if (!block) continue;
        if (block.typeId === cfg.fletchingTable) {
          found = "ranged";
          break;
        }
        if (block.typeId === cfg.grindstone) found = "melee";
      }
    }
  }
  return found;
}

function applyStation(guard, mode, force) {
  if (!force && guard.getDynamicProperty(P.mode) === mode) return;
  try {
    guard.triggerEvent(mode === "ranged" ? "wp:set_ranged" : "wp:set_melee");
    guard.setDynamicProperty(P.mode, mode);
  } catch {
    return;
  }
  // The weapon is cosmetic - the behaviours work with empty hands too.
  const item = mode === "ranged" ? GUARD_CONFIG.weapons.ranged : GUARD_CONFIG.weapons.melee;
  try {
    guard.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${item}`);
  } catch {}
}

function guardUpkeep(elapsed) {
  const cfg = GUARD_CONFIG;
  let players;
  try {
    players = world.getAllPlayers();
  } catch {
    return;
  }
  const seen = new Set();
  const leashPass = elapsed % cfg.leash.checkIntervalTicks === 0;
  for (const player of players) {
    let guards;
    try {
      guards = player.dimension.getEntities({ type: cfg.typeId, location: player.location, maxDistance: 64 });
    } catch {
      continue;
    }
    for (const guard of guards) {
      if (seen.has(guard.id)) continue;
      seen.add(guard.id);
      try {
        const station = nearbyStation(guard);
        if (station) applyStation(guard, station, false);
        else if (guard.getDynamicProperty(P.mode) === undefined) applyStation(guard, "melee", true);
        if (leashPass) leashHome(guard);
      } catch {}
    }
  }
}

function leashHome(guard) {
  const raw = guard.getDynamicProperty(P.home);
  if (typeof raw !== "string") return;
  let home;
  try {
    home = JSON.parse(raw);
  } catch {
    return;
  }
  const loc = guard.location;
  const dx = loc.x - home.x;
  const dz = loc.z - home.z;
  if (Math.sqrt(dx * dx + dz * dz) <= GUARD_CONFIG.leash.maxDistance) return;
  // Only drag it back when it is not busy fighting.
  try {
    if (guard.target) return;
  } catch {}
  const spot = findGround(guard.dimension, home.x, home.y, home.z);
  if (spot) {
    try {
      guard.teleport(spot, { dimension: guard.dimension });
    } catch {}
  }
}
