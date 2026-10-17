import { world, system, EntityDamageCause } from "@minecraft/server";

// Gameplay rules that are independent of individual waypoints. Everything
// tunable lives in this one object.
export const GAMEPLAY_CONFIG = {
  // Speed boost while walking on a road built from path blocks.
  pathSpeed: {
    blocks: ["minecraft:grass_path", "minecraft:dirt_path"],
    thickness: 3,
    // "vertical": `thickness` path blocks stacked beneath the player.
    // "horizontal": the player stands on a strip of path blocks at least
    // `thickness` wide (along X or Z).
    orientation: "horizontal",
    amplifier: 1,         // Speed II
    durationTicks: 40,    // 2 s, refreshed on every check while still on the road
    checkIntervalTicks: 10
  },
  // Sanctuary Waypoint (diamond block beneath): hostile mobs are pushed out.
  ward: {
    radius: 20,
    minPush: 1.2,         // knockback at the edge of the radius
    maxPush: 2.6,         // knockback right next to the monument
    verticalPush: 0.25,
    families: ["monster"]
  },
  waypointLimit: {
    perPlayer: 5
  },
  // Experience levels charged per action (creative mode is exempt).
  costs: {
    teleportLevels: 10,
    enchantLevels: 50
  },
  mobBuffs: {
    extraDamage: 4,       // 2 hearts on top of every hit a hostile mob lands
    playersOnly: true,    // only players take the extra damage
    families: ["monster"]
  },
  phantomBite: {
    effects: ["weakness", "slowness", "nausea"],
    amplifier: 0,        // level I
    durationTicks: 100,  // 5 s
    healAmount: 1       // one health point (half a heart) per player bite
  },
  explosions: {
    // These exploders still hurt entities but never break blocks.
    noBlockDamageFrom: ["minecraft:creeper"]
  },
  // 10x minecarts. The speed cap lives in entities/*minecart.json
  // (minecraft:rail_movement.max_speed); powered rails only add 0.06 blocks/tick
  // in vanilla, so this rule multiplies a cart's speed every tick while it sits
  // on a powered rail, until the cap is reached. Plain rails brake as usual.
  minecart: {
    maxSpeed: 4.0,          // blocks per tick, must match the entity JSON
    boostPerTick: 1.25,
    minSpeed: 0.02,         // a cart slower than this is standing still
    poweredRail: "minecraft:golden_rail",
    radius: 48
  }
};

const PATH_BLOCKS = new Set(GAMEPLAY_CONFIG.pathSpeed.blocks);

export function initGameplay() {
  startPathSpeed();
  startPhantomBites();
  startMobBuffs();
  startExplosionRules();
  startMinecartBoost();
}

// ---------------------------------------------------------------------------
// Minecarts
// ---------------------------------------------------------------------------

function isPoweredRail(dimension, loc, railId) {
  // The cart's origin sits a hair above the rail, so look at its own block
  // first and the one beneath as a fallback (slopes).
  const x = Math.floor(loc.x), z = Math.floor(loc.z);
  for (const y of [Math.floor(loc.y), Math.floor(loc.y) - 1]) {
    let block;
    try {
      block = dimension.getBlock({ x, y, z });
    } catch {
      return false;
    }
    if (!block) return false;
    if (block.typeId !== railId) continue;
    try {
      return block.permutation.getState("rail_data_bit") === true;
    } catch {
      return true;
    }
  }
  return false;
}

function startMinecartBoost() {
  const cfg = GAMEPLAY_CONFIG.minecart;
  const cap = cfg.maxSpeed * 0.98;
  system.runInterval(() => {
    let players;
    try {
      players = world.getAllPlayers();
    } catch {
      return;
    }
    const done = new Set();
    for (const player of players) {
      let carts;
      try {
        carts = player.dimension.getEntities({ location: player.location, maxDistance: cfg.radius, families: ["minecart"] });
      } catch {
        continue;
      }
      for (const cart of carts) {
        if (done.has(cart.id)) continue;
        done.add(cart.id);
        try {
          const v = cart.getVelocity();
          const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
          if (speed < cfg.minSpeed || speed >= cap) continue;
          if (!isPoweredRail(cart.dimension, cart.location, cfg.poweredRail)) continue;
          const target = Math.min(cap, speed * cfg.boostPerTick);
          const k = (target - speed) / speed;
          cart.applyImpulse({ x: v.x * k, y: v.y * k, z: v.z * k });
        } catch {}
      }
    }
  }, 1);
}

// ---------------------------------------------------------------------------
// Road speed
// ---------------------------------------------------------------------------

function startPathSpeed() {
  const cfg = GAMEPLAY_CONFIG.pathSpeed;
  system.runInterval(() => {
    let players;
    try {
      players = world.getAllPlayers();
    } catch {
      return;
    }
    for (const player of players) {
      try {
        if (!isOnThickPath(player, cfg)) continue;
        const existing = player.getEffect("speed");
        if (
          existing &&
          (existing.amplifier > cfg.amplifier ||
            (existing.amplifier === cfg.amplifier && existing.duration > cfg.durationTicks))
        ) {
          continue;
        }
        player.addEffect("speed", cfg.durationTicks, { amplifier: cfg.amplifier, showParticles: false });
      } catch {}
    }
  }, cfg.checkIntervalTicks);
}

// Path blocks are 15/16 high, so a player standing on one is still inside
// its top slice; sampling slightly below the feet finds the right block
// for both full blocks and path blocks.
function isOnThickPath(player, cfg) {
  const loc = player.location;
  const x = Math.floor(loc.x);
  const z = Math.floor(loc.z);
  const y = Math.floor(loc.y - 0.05);
  const dim = player.dimension;
  const isPath = (px, py, pz) => {
    const block = dim.getBlock({ x: px, y: py, z: pz });
    return !!block && PATH_BLOCKS.has(block.typeId);
  };
  if (!isPath(x, y, z)) return false;
  const n = Math.max(1, cfg.thickness | 0);

  if (cfg.orientation === "horizontal") {
    // A run of `n` path blocks in a row that includes the player's block,
    // along either horizontal axis.
    for (let start = -(n - 1); start <= 0; start++) {
      let ok = true;
      for (let i = 0; i < n && ok; i++) ok = isPath(x + start + i, y, z);
      if (ok) return true;
    }
    for (let start = -(n - 1); start <= 0; start++) {
      let ok = true;
      for (let i = 0; i < n && ok; i++) ok = isPath(x, y, z + start + i);
      if (ok) return true;
    }
    return false;
  }

  for (let i = 1; i < n; i++) {
    if (!isPath(x, y - i, z)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Sanctuary ward
// ---------------------------------------------------------------------------

// Pushes every hostile mob inside the ward radius away from the centre.
// Returns the number of mobs that were pushed.
export function repelHostiles(dimension, center) {
  const cfg = GAMEPLAY_CONFIG.ward;
  let mobs;
  try {
    mobs = dimension.getEntities({ location: center, maxDistance: cfg.radius, families: cfg.families });
  } catch {
    return 0;
  }
  for (const mob of mobs) {
    try {
      const loc = mob.location;
      let dx = loc.x - center.x;
      let dz = loc.z - center.z;
      let dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.01) {
        const angle = Math.random() * Math.PI * 2;
        dx = Math.cos(angle);
        dz = Math.sin(angle);
        dist = 1;
      }
      const depth = 1 - Math.min(dist, cfg.radius) / cfg.radius;
      const strength = cfg.minPush + (cfg.maxPush - cfg.minPush) * depth;
      const ux = dx / dist;
      const uz = dz / dist;
      try {
        mob.applyKnockback({ x: ux * strength, z: uz * strength }, cfg.verticalPush);
      } catch {
        // Pre-2.0 signature: (directionX, directionZ, horizontalStrength, verticalStrength)
        mob.applyKnockback(ux, uz, strength, cfg.verticalPush);
      }
    } catch {}
  }
  return mobs.length;
}

// ---------------------------------------------------------------------------
// Phantom bites and hostile mob buffs
// ---------------------------------------------------------------------------

function startPhantomBites() {
  const cfg = GAMEPLAY_CONFIG.phantomBite;
  // The entity definition makes the bite deal zero damage. Listen for the
  // melee hit itself rather than entityHurt, which requires actual damage.
  world.afterEvents.entityHitEntity.subscribe((ev) => {
    try {
      const phantom = ev.damagingEntity;
      const player = ev.hitEntity;
      if (phantom.typeId !== "minecraft:phantom" || player.typeId !== "minecraft:player") return;
      for (const effect of cfg.effects) {
        player.addEffect(effect, cfg.durationTicks, { amplifier: cfg.amplifier, showParticles: true });
      }
      const health = phantom.getComponent("minecraft:health");
      if (health && health.currentValue > 0) {
        health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + cfg.healAmount));
      }
    } catch {}
  });
}

function isHostile(entity, families) {
  try {
    const family = entity.getComponent("minecraft:type_family");
    if (family) return families.some((f) => family.hasTypeFamily(f));
  } catch {}
  try {
    return entity.matches({ families });
  } catch {
    return false;
  }
}

function projectileOwner(projectile) {
  try {
    return projectile?.getComponent("minecraft:projectile")?.owner;
  } catch {
    return undefined;
  }
}

function startMobBuffs() {
  const cfg = GAMEPLAY_CONFIG.mobBuffs;

  // Extra damage is applied straight to the health component so it can never
  // be swallowed by hurt cooldown; the lethal case goes through applyDamage
  // with the `override` cause so the kill is credited to the mob.
  world.afterEvents.entityHurt.subscribe((ev) => {
    try {
      const source = ev.damageSource;
      if (source.cause === EntityDamageCause.override) return;
      if (ev.damage <= 0) return;
      const victim = ev.hurtEntity;
      if (cfg.playersOnly && victim.typeId !== "minecraft:player") return;
      const attacker = source.damagingEntity ?? projectileOwner(source.damagingProjectile);
      if (!attacker || attacker.id === victim.id || !isHostile(attacker, cfg.families)) return;
      // A phantom bite only applies its debuffs; it never gains bonus damage.
      if (attacker.typeId === "minecraft:phantom") return;

      const health = victim.getComponent("minecraft:health");
      if (!health || health.currentValue <= 0) return;
      const remaining = health.currentValue - cfg.extraDamage;
      if (remaining > 0) {
        health.setCurrentValue(remaining);
        return;
      }
      try {
        victim.applyDamage(1000, { cause: EntityDamageCause.override, damagingEntity: attacker });
      } catch {}
      try {
        const after = victim.getComponent("minecraft:health");
        if (after && after.currentValue > 0) after.setCurrentValue(0);
      } catch {}
    } catch {}
  });
}

// ---------------------------------------------------------------------------
// Explosions
// ---------------------------------------------------------------------------

function startExplosionRules() {
  const cfg = GAMEPLAY_CONFIG.explosions;
  world.beforeEvents.explosion.subscribe((ev) => {
    try {
      const source = ev.source;
      if (source && cfg.noBlockDamageFrom.includes(source.typeId)) {
        ev.setImpactedBlocks([]);
      }
    } catch {}
  });
}
