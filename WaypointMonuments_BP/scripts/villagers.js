import { world, system } from "@minecraft/server";

// Villager grudges and autonomous breeding.
//
// Villagers keep their vanilla behaviour and never fight back - defending the
// village is the Village Guard's job (guards.js). The entity override in
// entities/villager_v2.json only adds:
//   wp:taxed_<profession>            profession groups pointing at +30 % trades
//   event wp:apply_tax               switches a villager over to those
//   type family "wp_villager_plus"   marker proving the override is loaded
// This module decides WHEN the tax applies, and warns if the marker is missing.
export const VILLAGER_CONFIG = {
  typeId: "minecraft:villager_v2",
  markerFamily: "wp_villager_plus",
  hitsToProvoke: 2,           // the first hit is forgiven
  hitMemoryTicks: 2400,       // ...and forgotten after 2 minutes
  grudgeTicks: 9600,          // 8 minutes of cold shoulder before the price rise
  rallyRadius: 24,            // villagers this close to the victim take offence
  professionVariants: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  tickIntervalTicks: 100,
  scanRadius: 64,
  breeding: {
    undamagedTicks: 240000,   // 10 in-game days without taking any damage
    cooldownTicks: 24000,     // a parent waits a day before breeding again
    pairRadius: 8,
    crowdRadius: 32,
    maxNearby: 12,
    scanIntervalTicks: 1200
  }
};

const P = {
  lastHurt: "wp:v_lastHurt",
  seen: "wp:v_seen",
  hits: "wp:v_hits",
  grudgeUntil: "wp:v_grudgeUntil",
  taxPending: "wp:v_taxPending",
  taxed: "wp:v_taxed",
  lastBreed: "wp:v_lastBreed"
};

export function initVillagers() {
  const cfg = VILLAGER_CONFIG;

  world.afterEvents.entityHurt.subscribe((ev) => {
    try {
      const villager = ev.hurtEntity;
      if (villager.typeId !== cfg.typeId) return;
      onVillagerHurt(villager, ev.damageSource);
    } catch {}
  });

  // A grudge that ran out while the player was away is settled on login.
  world.afterEvents.playerSpawn.subscribe((ev) => {
    try {
      if (!ev.initialSpawn) return;
      settleGrudge(ev.player, now());
    } catch {}
  });

  let elapsed = 0;
  system.runInterval(() => {
    elapsed += cfg.tickIntervalTicks;
    try {
      periodic(elapsed % cfg.breeding.scanIntervalTicks === 0);
    } catch {}
  }, cfg.tickIntervalTicks);
}

export function isVillagerFoe(player) {
  try {
    const until = player.getDynamicProperty(P.grudgeUntil);
    return typeof until === "number" && now() < until;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

function now() {
  return world.getAbsoluteTime();
}

function isBaby(entity) {
  try {
    return !!entity.getComponent("minecraft:is_baby");
  } catch {
    return false;
  }
}

function variantOf(entity) {
  try {
    const v = entity.getComponent("minecraft:variant");
    return v ? v.value : 0;
  } catch {
    return 0;
  }
}

function attackerOf(source) {
  if (source.damagingEntity) return source.damagingEntity;
  try {
    return source.damagingProjectile?.getComponent("minecraft:projectile")?.owner;
  } catch {
    return undefined;
  }
}

function readHits(villager) {
  try {
    const raw = villager.getDynamicProperty(P.hits);
    if (typeof raw === "string") return JSON.parse(raw);
  } catch {}
  return undefined;
}

function onVillagerHurt(villager, source) {
  const cfg = VILLAGER_CONFIG;
  const t = now();
  villager.setDynamicProperty(P.lastHurt, t);

  const attacker = attackerOf(source);
  if (!attacker || attacker.typeId !== "minecraft:player") return;

  if (isVillagerFoe(attacker)) {
    takeOffence(attacker, villager, t);
    return;
  }

  let memory = readHits(villager);
  if (!memory || memory.p !== attacker.id || t - memory.t > cfg.hitMemoryTicks) {
    memory = { p: attacker.id, n: 0, t };
  }
  memory.n += 1;
  memory.t = t;

  if (memory.n >= cfg.hitsToProvoke) {
    villager.setDynamicProperty(P.hits, undefined);
    takeOffence(attacker, villager, t);
    return;
  }
  villager.setDynamicProperty(P.hits, JSON.stringify(memory));
  try {
    attacker.sendMessage("§eThe villager staggers back. §7Strike again and the village will remember it.");
  } catch {}
}

// The village turns cold: nobody fights back, but every villager who saw it
// will raise its prices once the grudge burns out.
function takeOffence(player, victim, t) {
  const cfg = VILLAGER_CONFIG;
  const until = t + cfg.grudgeTicks;
  const wasFoe = isVillagerFoe(player);
  player.setDynamicProperty(P.grudgeUntil, until);

  let witnesses = 0;
  try {
    const nearby = victim.dimension.getEntities({
      type: cfg.typeId,
      location: victim.location,
      maxDistance: cfg.rallyRadius
    });
    for (const v of nearby) {
      if (isBaby(v)) continue;
      v.setDynamicProperty(P.taxPending, true);
      witnesses++;
    }
  } catch {}

  try {
    if (!wasFoe) {
      player.sendMessage(`§cThe villagers turn away from you. §7${witnesses} of them saw it — in 8 minutes their prices go up.`);
      player.playSound("mob.villager.no");
    } else {
      player.sendMessage("§cThe village's resentment deepens.");
    }
  } catch {}
}

// If the game rejected entities/villager_v2.json (content error) it silently
// falls back to the vanilla villager, and nothing in this module can work.
// The override stamps every villager with a marker family; its absence is
// reported once per session so the problem is visible in-game.
let overrideChecked = false;

function checkOverride(villager, players) {
  if (overrideChecked) return;
  overrideChecked = true;
  let ok = false;
  try {
    const fam = villager.getComponent("minecraft:type_family");
    ok = !!fam && fam.hasTypeFamily(VILLAGER_CONFIG.markerFamily);
  } catch {
    ok = false;
  }
  if (ok) return;
  console.error("[Waypoint] entities/villager_v2.json is NOT the active villager definition - check the Content Log for errors in that file.");
  for (const p of players) {
    try {
      p.sendMessage("§c[Waypoint] The villager override did not load — villagers will behave like vanilla. §7See Settings → Creator → Content Log.");
    } catch {}
  }
}

function settleGrudge(player, t) {
  const until = player.getDynamicProperty(P.grudgeUntil);
  if (typeof until !== "number" || t < until) return;
  player.setDynamicProperty(P.grudgeUntil, undefined);
  try {
    player.sendMessage("§aThe villagers have calmed down. §7They will not forget: their prices are 30% higher for you all now.");
  } catch {}
}

// ---------------------------------------------------------------------------

function periodic(breedingPass) {
  const cfg = VILLAGER_CONFIG;
  const t = now();
  let players;
  try {
    players = world.getAllPlayers();
  } catch {
    return;
  }

  for (const player of players) {
    try {
      settleGrudge(player, t);
    } catch {}

    let villagers;
    try {
      villagers = player.dimension.getEntities({ type: cfg.typeId, location: player.location, maxDistance: cfg.scanRadius });
    } catch {
      continue;
    }
    if (villagers.length > 0) checkOverride(villagers[0], players);
    for (const v of villagers) {
      try {
        settleVillager(v, t);
      } catch {}
    }
    if (breedingPass) {
      try {
        breedingScan(player.dimension, villagers, t);
      } catch {}
    }
  }
}

// Applies the grudge tax once the villager has a profession to tax
// (an unskilled villager is taxed when it takes a job).
function settleVillager(v, t) {
  const cfg = VILLAGER_CONFIG;
  const pending = v.getDynamicProperty(P.taxPending) === true;
  if (pending && v.getDynamicProperty(P.taxed) !== true) {
    if (cfg.professionVariants.includes(variantOf(v))) {
      v.triggerEvent("wp:apply_tax");
      v.setDynamicProperty(P.taxed, true);
      v.setDynamicProperty(P.taxPending, undefined);
    }
  }
}

function breedingScan(dimension, villagers, t) {
  const cfg = VILLAGER_CONFIG.breeding;
  const eligible = [];
  for (const v of villagers) {
    if (isBaby(v)) continue;
    let lastHurt = v.getDynamicProperty(P.lastHurt);
    if (typeof lastHurt !== "number") {
      // Never hurt since the pack was enabled: the clock starts when we first meet it.
      lastHurt = v.getDynamicProperty(P.seen);
      if (typeof lastHurt !== "number") {
        v.setDynamicProperty(P.seen, t);
        continue;
      }
    }
    if (t - lastHurt < cfg.undamagedTicks) continue;
    const lastBreed = v.getDynamicProperty(P.lastBreed);
    if (typeof lastBreed === "number" && t - lastBreed < cfg.cooldownTicks) continue;
    eligible.push(v);
  }
  if (eligible.length < 2) return;

  const used = new Set();
  for (const a of eligible) {
    if (used.has(a.id)) continue;
    const mate = eligible.find((b) => b !== a && !used.has(b.id) && distance(a.location, b.location) <= cfg.pairRadius);
    if (!mate) continue;
    const crowd = dimension.getEntities({ type: VILLAGER_CONFIG.typeId, location: a.location, maxDistance: cfg.crowdRadius }).length;
    if (crowd >= cfg.maxNearby) return;
    used.add(a.id);
    used.add(mate.id);
    a.setDynamicProperty(P.lastBreed, t);
    mate.setDynamicProperty(P.lastBreed, t);
    spawnBaby(dimension, a.location, mate.location);
    return; // one birth per scan per neighbourhood keeps growth gentle
  }
}

function distance(p, q) {
  const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function spawnBaby(dimension, a, b) {
  const x = (a.x + b.x) / 2, y = Math.max(a.y, b.y), z = (a.z + b.z) / 2;
  try {
    // villager_v2 is made summonable by our entity override; running the born
    // event instead of entity_spawned yields a proper baby.
    dimension.runCommand(`summon ${VILLAGER_CONFIG.typeId} ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} minecraft:entity_born`);
    dimension.spawnParticle("minecraft:heart_particle", { x, y: y + 1.5, z });
    dimension.playSound("mob.villager.yes", { x, y, z });
  } catch {}
}
