import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import {
  MODE_NONE,
  MODE_TELEPORT,
  MODE_ENCHANT,
  MODE_WARD,
  MODE_LABELS,
  MODE_COLORS,
  ACTIVATORS,
  syncBlockMode,
  spawnModeParticles
} from "./modes.js";
import { enchantHeldItem } from "./enchanting.js";
import { GAMEPLAY_CONFIG, initGameplay, repelHostiles } from "./gameplay.js";
import { DEEPSKY_CONFIG, initDeepSky, isDeepSkyVisitor, isInDeepSky, enterDeepSky, hasEntryEffect } from "./deepsky.js";
import { initVillagers } from "./villagers.js";
import { initGuards } from "./guards.js";
import { initBuildings } from "./buildings.js";
import { initBlackWings, stopBlackWingsFlight } from "./black-wings.js";

const BLOCK_ID = "wp:waypoint";
const PROP_ID = "wp:waypoints";
const MENU_COMPONENT = "wp:waypoint_menu";
const INTERACT_RANGE = 8;
const MAX_WAYPOINTS_PER_PLAYER = GAMEPLAY_CONFIG.waypointLimit.perPlayer;
const TELEPORT_COST = GAMEPLAY_CONFIG.costs.teleportLevels;
const ENCHANT_COST = GAMEPLAY_CONFIG.costs.enchantLevels;

const DIM_NAMES = {
  "minecraft:overworld": "Overworld",
  "minecraft:nether": "Nether",
  "minecraft:the_end": "The End"
};

// ---------------------------------------------------------------------------
// Registry (persisted in world dynamic properties)
// ---------------------------------------------------------------------------

// A single string dynamic property is capped at 32767 UTF-8 bytes (~250
// waypoints), so the list is stored as entry-grouped shards:
//   wp:waypoints/count -> number of shards
//   wp:waypoints/<n>   -> JSON array of entries
// The legacy single-blob property (wp:waypoints) is read once and migrated.
const SHARD_COUNT_ID = `${PROP_ID}/count`;
const SHARD_BYTE_LIMIT = 24000;
const MAX_NAME_LENGTH = 64;

// The parsed list is cached in memory; every mutation goes through
// saveWaypoints, which refreshes the cache only after the write succeeded.
let registryCache = null;

// TextEncoder is not available in the Bedrock runtime.
function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function parseShard(raw, label) {
  if (typeof raw !== "string") return [];
  try {
    const part = JSON.parse(raw);
    if (Array.isArray(part)) return part;
  } catch {}
  console.warn(`[Waypoint] registry shard "${label}" is unreadable and was skipped`);
  return [];
}

function loadWaypoints() {
  if (registryCache) return registryCache;
  const list = [];
  try {
    const count = world.getDynamicProperty(SHARD_COUNT_ID);
    if (typeof count === "number") {
      for (let i = 0; i < count; i++) {
        list.push(...parseShard(world.getDynamicProperty(`${PROP_ID}/${i}`), String(i)));
      }
    } else {
      list.push(...parseShard(world.getDynamicProperty(PROP_ID), "legacy"));
    }
  } catch {}
  registryCache = list;
  return list;
}

function saveWaypoints(list) {
  const shards = [];
  let current = [];
  let currentBytes = 2;
  for (const entry of list) {
    const encoded = utf8Length(JSON.stringify(entry)) + 1;
    if (current.length > 0 && currentBytes + encoded > SHARD_BYTE_LIMIT) {
      shards.push(current);
      current = [];
      currentBytes = 2;
    }
    current.push(entry);
    currentBytes += encoded;
  }
  shards.push(current);
  const payloads = shards.map((shard) => JSON.stringify(shard));

  const previousCount = world.getDynamicProperty(SHARD_COUNT_ID);
  try {
    payloads.forEach((payload, i) => world.setDynamicProperty(`${PROP_ID}/${i}`, payload));
    if (typeof previousCount === "number") {
      for (let i = shards.length; i < previousCount; i++) {
        world.setDynamicProperty(`${PROP_ID}/${i}`, undefined);
      }
    } else {
      world.setDynamicProperty(PROP_ID, undefined);
    }
    world.setDynamicProperty(SHARD_COUNT_ID, shards.length);
    registryCache = list;
  } catch (e) {
    // Never let memory run ahead of storage: re-read what was persisted.
    registryCache = null;
    throw e;
  }
}

function keyFor(dimId, loc) {
  return `${dimId}|${loc.x},${loc.y},${loc.z}`;
}

function findWaypoint(list, key) {
  return list.find((w) => w.key === key);
}

function countOwnedWaypoints(list, playerId) {
  let n = 0;
  for (const w of list) if (w.owner === playerId) n++;
  return n;
}

// Records the last known mode of a registered waypoint so the teleport list
// can be built without loading every destination chunk.
function updateWaypointMode(key, mode) {
  const list = loadWaypoints();
  const wp = findWaypoint(list, key);
  if (!wp || (wp.mode ?? MODE_NONE) === mode) return;
  wp.mode = mode;
  saveWaypoints(list);
}

function pruneWaypoint(key) {
  const list = loadWaypoints();
  const idx = list.findIndex((w) => w.key === key);
  if (idx !== -1) {
    list.splice(idx, 1);
    saveWaypoints(list);
  }
}

function tryGetBlock(dim, loc) {
  try {
    return dim.getBlock({ x: loc.x, y: loc.y, z: loc.z });
  } catch {
    return undefined;
  }
}

function reportError(player, err) {
  try {
    player.sendMessage(`§c[Waypoint] Error: ${err}`);
  } catch {}
}

function sleepTicks(ticks) {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

// Bedrock silently cancels forms with UserBusy while the interaction that
// triggered them is still winding down, so retry for up to ~10 seconds.
async function showForm(player, form) {
  const deadline = system.currentTick + 200;
  while (system.currentTick < deadline) {
    const res = await form.show(player);
    if (res.cancelationReason !== FormCancelationReason.UserBusy) return res;
    await sleepTicks(5);
  }
  return undefined;
}

function distanceTo(player, loc) {
  const p = player.location;
  const dx = p.x - (loc.x + 0.5);
  const dy = p.y - (loc.y + 0.5);
  const dz = p.z - (loc.z + 0.5);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isCreative(player) {
  try {
    return String(player.getGameMode()).toLowerCase() === "creative";
  } catch {
    return false;
  }
}

// Returns true when the player could pay (or is exempt) and the levels were taken.
function chargeLevels(player, amount, what) {
  if (amount <= 0 || isCreative(player)) return true;
  if (player.level < amount) {
    player.sendMessage(`§c${what} costs §f${amount} levels§c — you have ${player.level}.`);
    try {
      player.playSound("note.bass");
    } catch {}
    return false;
  }
  player.addLevels(-amount);
  player.sendMessage(`§7-${amount} levels.`);
  return true;
}

function costLine(player, amount) {
  if (isCreative(player)) return "§7Cost: §fnone §7(creative)";
  return `§7Cost: §f${amount} levels §7(you have ${player.level})`;
}

// ---------------------------------------------------------------------------
// Block component: interaction + mode ticking
// ---------------------------------------------------------------------------

// The custom component and the world-event fallback can both fire on one
// click; a short per-player cooldown keeps the menu from opening twice.
const recentMenu = new Map();

function openMenu(player, dimId, loc) {
  try {
    if (player.isSneaking) return;
    if (isDeepSkyVisitor(player)) {
      player.sendMessage("§dThe Deep Sky does not answer to waypoints. Wait for the potion to fade.");
      return;
    }
    const now = system.currentTick;
    const last = recentMenu.get(player.id);
    if (last !== undefined && now - last < 10) return;
    recentMenu.set(player.id, now);

    const key = keyFor(dimId, loc);
    const x = loc.x, y = loc.y, z = loc.z;
    system.run(() => {
      try {
        const list = loadWaypoints();
        let wp = findWaypoint(list, key);
        if (!wp) {
          // A monument that was never registered (placed by command or by an
          // older version) is claimed by the first player who uses it.
          wp = { key, name: "", x, y, z, dim: dimId, active: false, mode: MODE_NONE, owner: player.id, ownerName: player.name };
          list.push(wp);
          saveWaypoints(list);
        }
        if (!wp.active) {
          showNameForm(player, key, false);
        } else {
          showWaypointMenu(player, key);
        }
      } catch (e) {
        reportError(player, e);
      }
    });
  } catch (e) {
    reportError(player, e);
  }
}

// Runs on the engine's block tick for every loaded monument: keeps the
// visual state in sync with the activator beneath it, emits ambience and
// drives the Sanctuary ward.
function tickWaypoint(block) {
  try {
    const key = keyFor(block.dimension.id, block.location);
    const { mode, changed } = syncBlockMode(block);
    if (changed) {
      updateWaypointMode(key, mode);
    }
    spawnModeParticles(block, mode);
    // Only monuments a player registered get to repel mobs.
    if (mode === MODE_WARD && findWaypoint(loadWaypoints(), key)) {
      const loc = block.location;
      repelHostiles(block.dimension, { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 });
    }
  } catch {}
}

// Runs before the block is placed; cancelling keeps the item in hand.
function beforePlaceWaypoint(e) {
  const player = e.player;
  if (!player) return;
  if (isInDeepSky(e.dimension.id, e.block.location)) {
    e.cancel = true;
    system.run(() => {
      try {
        player.sendMessage("§dNo monument can take root in The Deep Sky.");
      } catch {}
    });
    return;
  }
  let owned;
  try {
    owned = countOwnedWaypoints(loadWaypoints(), player.id);
  } catch {
    return;
  }
  if (owned < MAX_WAYPOINTS_PER_PLAYER) return;
  e.cancel = true;
  system.run(() => {
    try {
      player.sendMessage(`§cYou already have ${owned}/${MAX_WAYPOINTS_PER_PLAYER} waypoints. §7Break one to place another.`);
      player.playSound("note.bass");
    } catch {}
  });
}

// Primary interaction path: block custom component (canonical for 1.21+,
// also shows the "Use" hint on touch controls)
try {
  system.beforeEvents.startup.subscribe((ev) => {
    ev.blockComponentRegistry.registerCustomComponent(MENU_COMPONENT, {
      beforeOnPlayerPlace(e) {
        beforePlaceWaypoint(e);
      },
      onPlayerInteract(e) {
        if (!e.player) return;
        openMenu(e.player, e.dimension.id, e.block.location);
      },
      onTick(e) {
        tickWaypoint(e.block);
      }
    });
  });
} catch {}

initGameplay();
initDeepSky();
initVillagers();
initGuards();
initBuildings();
initBlackWings();

// Warm the registry cache outside of any read-only context so the first
// placement check never has to hit storage from inside a before-event.
system.run(() => {
  try {
    loadWaypoints();
  } catch {}
});

// Fallback interaction path, deduped by the cooldown in openMenu
try {
  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    if (ev.isFirstEvent === false) return;
    if (ev.block.typeId !== BLOCK_ID) return;
    openMenu(ev.player, ev.block.dimension.id, ev.block.location);
  });
} catch {}

// ---------------------------------------------------------------------------
// World events: placing / breaking monuments and their activators
// ---------------------------------------------------------------------------

// Waypoints only enter the registry through player actions: this event
// never fires for /setblock, so a monument placed any other way stays inert.
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  try {
    if (ev.block.typeId === BLOCK_ID) {
      onMonumentPlaced(ev.player, ev.block);
      return;
    }
    if (ACTIVATORS[ev.block.typeId]) {
      onActivatorChanged(ev.player, ev.block);
    }
  } catch (e) {
    reportError(ev.player, e);
  }
});

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  try {
    if (ev.brokenBlockPermutation.type.id === BLOCK_ID) {
      onMonumentBroken(ev.player, ev.dimension, ev.block.location);
      return;
    }
    if (ACTIVATORS[ev.brokenBlockPermutation.type.id]) {
      onActivatorChanged(ev.player, ev.block);
    }
  } catch (e) {
    reportError(ev.player, e);
  }
});

// Activators can also vanish without a player: explosions and pistons.
try {
  world.afterEvents.blockExplode.subscribe((ev) => {
    try {
      const explodedId = ev.explodedBlockPermutation.type.id;
      if (explodedId === BLOCK_ID) {
        pruneWaypoint(keyFor(ev.dimension.id, ev.block.location));
      } else if (ACTIVATORS[explodedId]) {
        onActivatorChanged(undefined, ev.block);
      }
    } catch {}
  });
} catch {}

const NEIGHBOUR_OFFSETS = [
  { x: 0, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
  { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }
];

try {
  world.afterEvents.pistonActivate.subscribe((ev) => {
    try {
      const dimension = ev.dimension;
      const moved = ev.piston.getAttachedBlocksLocations();
      if (moved.length === 0) return;
      // Blocks finish moving a few ticks after the event; then re-check every
      // monument that sits above a moved block's old or new position.
      system.runTimeout(() => {
        try {
          const checked = new Set();
          for (const loc of moved) {
            for (const o of NEIGHBOUR_OFFSETS) {
              const pos = { x: loc.x + o.x, y: loc.y + o.y + 1, z: loc.z + o.z };
              const key = keyFor(dimension.id, pos);
              if (checked.has(key)) continue;
              checked.add(key);
              const block = tryGetBlock(dimension, pos);
              if (!block || block.typeId !== BLOCK_ID) continue;
              const { mode } = syncBlockMode(block);
              updateWaypointMode(key, mode);
            }
          }
        } catch {}
      }, 4);
    } catch {}
  });
} catch {}

function onMonumentPlaced(player, block) {
  const list = loadWaypoints();
  const key = keyFor(block.dimension.id, block.location);
  if (!findWaypoint(list, key)) {
    list.push({
      key,
      name: "",
      x: block.location.x,
      y: block.location.y,
      z: block.location.z,
      dim: block.dimension.id,
      active: false,
      mode: MODE_NONE,
      owner: player.id,
      ownerName: player.name
    });
    saveWaypoints(list);
  }
  system.run(() => {
    try {
      const { mode } = syncBlockMode(block);
      updateWaypointMode(key, mode);
    } catch {}
  });
  const owned = countOwnedWaypoints(list, player.id);
  player.sendMessage(`§bWaypoint monument placed §7(${owned}/${MAX_WAYPOINTS_PER_PLAYER}). Right-click it to activate.`);
}

function onMonumentBroken(player, dimension, location) {
  const key = keyFor(dimension.id, location);
  const list = loadWaypoints();
  const idx = list.findIndex((w) => w.key === key);
  if (idx !== -1) {
    const removed = list.splice(idx, 1)[0];
    saveWaypoints(list);
    if (removed.active) {
      player.sendMessage(`§bWaypoint "§f${removed.name}§b" removed from the network.`);
    }
  }
}

// An activator block was placed or removed: if a monument sits directly on
// top of it, switch the monument's mode right away and tell the player.
function onActivatorChanged(player, activatorBlock) {
  let above;
  try {
    above = activatorBlock.above(1);
  } catch {
    return;
  }
  if (!above || above.typeId !== BLOCK_ID) return;

  const key = keyFor(above.dimension.id, above.location);
  const list = loadWaypoints();
  const wp = findWaypoint(list, key);
  const previous = wp?.mode ?? MODE_NONE;
  const { mode } = syncBlockMode(above);
  updateWaypointMode(key, mode);
  if (mode === previous) return;

  if (!player) return;
  const label = wp?.active && wp.name ? `"§f${wp.name}§7"` : "this monument";
  try {
    if (mode !== MODE_NONE) {
      player.sendMessage(`${MODE_COLORS[mode]}${MODE_LABELS[mode]} §7activated at ${label}.`);
      player.playSound("beacon.power");
    } else {
      player.sendMessage(`§7${MODE_LABELS[previous]} deactivated at ${label}.`);
      player.playSound("beacon.deactivate");
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

async function showNameForm(player, key, renaming) {
  try {
    const currentName = renaming ? (findWaypoint(loadWaypoints(), key)?.name ?? "") : "";
    const form = new ModalFormData()
      .title(renaming ? "Rename Waypoint" : "Activate Waypoint")
      .textField("Waypoint name", "e.g. Home Base", { defaultValue: currentName })
      .submitButton(renaming ? "Rename" : "Activate");

    const res = await showForm(player, form);
    if (!res || res.canceled) return;

    const list = loadWaypoints();
    const wp = findWaypoint(list, key);
    if (!wp) return;
    const name = String(res.formValues[0] ?? "").trim().slice(0, MAX_NAME_LENGTH);
    // An empty rename keeps the existing name; an empty activation gets a default.
    wp.name = name.length > 0 ? name : (renaming && wp.name ? wp.name : `Waypoint ${wp.x}, ${wp.z}`);
    const wasActive = wp.active;
    wp.active = true;
    saveWaypoints(list);
    if (wasActive) {
      player.sendMessage(`§bWaypoint renamed to "§f${wp.name}§b".`);
    } else {
      player.sendMessage(`§bWaypoint "§f${wp.name}§b" is now active!`);
      player.playSound("beacon.activate");
    }
  } catch (e) {
    reportError(player, e);
  }
}

// The block beneath the monument is the source of truth for the mode, so it
// is re-read every time the menu opens.
function liveModeFor(wp) {
  const dim = world.getDimension(wp.dim);
  const block = tryGetBlock(dim, wp);
  if (!block || block.typeId !== BLOCK_ID) return wp.mode ?? MODE_NONE;
  const { mode } = syncBlockMode(block);
  if ((wp.mode ?? MODE_NONE) !== mode) updateWaypointMode(wp.key, mode);
  return mode;
}

async function showWaypointMenu(player, key) {
  try {
    const list = loadWaypoints();
    const self = findWaypoint(list, key);
    if (!self) return;
    const mode = liveModeFor(self);

    const form = new ActionFormData().title(`Waypoint: ${self.name}`);
    const actions = [];

    if (mode === MODE_TELEPORT) {
      if (hasEntryEffect(player)) {
        form.body(
          `§7Mode: §c${MODE_LABELS[mode]}\n\n` +
          `§dThe Slow Falling potion tugs at you — this waypoint can carry you into §f${DEEPSKY_CONFIG.name}§d.\n` +
          "§7You return the moment its effect fades. There is no dawn there, and no rest.\n\n" +
          costLine(player, TELEPORT_COST)
        );
        form.button(`§d✦ Rise into ${DEEPSKY_CONFIG.name}`);
        actions.push(() => enterDeepSkyFrom(player, self));
      } else {
        const targets = list.filter((w) => w.active && w.key !== key && w.mode === MODE_TELEPORT);
        if (targets.length === 0) {
          form.body(
            `§7Mode: §c${MODE_LABELS[mode]}\n\n` +
            "§7No other Teleport Waypoints yet.\nPlace a §cRedstone Block§7 beneath another activated monument to link them.\n\n" +
            costLine(player, TELEPORT_COST)
          );
        } else {
          form.body(`§7Mode: §c${MODE_LABELS[mode]}\n\n§7Choose a destination:\n${costLine(player, TELEPORT_COST)}`);
        }
        for (const t of targets) {
          const dimName = DIM_NAMES[t.dim] ?? t.dim;
          form.button(`${t.name}\n§8${t.x}, ${t.y}, ${t.z} — ${dimName}`);
          actions.push(() => teleportTo(player, self, t));
        }
      }
    } else if (mode === MODE_ENCHANT) {
      form.body(
        `§7Mode: §9${MODE_LABELS[mode]}\n\n` +
        "§7Hold a tool, weapon or armor piece and choose §fEnchant§7 to apply its full enchantment set.\n\n" +
        costLine(player, ENCHANT_COST)
      );
      form.button("§9Enchant held item");
      actions.push(() => enchantAt(player, self));
    } else if (mode === MODE_WARD) {
      form.body(
        `§7Mode: §b${MODE_LABELS[mode]}\n\n` +
        `§7Hostile mobs are kept §f${GAMEPLAY_CONFIG.ward.radius} blocks§7 away from this monument.`
      );
    } else {
      form.body(
        `§7Mode: §8${MODE_LABELS[MODE_NONE]}\n\n` +
        "§7Place a block directly beneath this monument:\n" +
        "§c• Redstone Block §7→ Teleport Waypoint\n" +
        "§9• Lapis Lazuli Block §7→ Enchanting Waypoint\n" +
        "§b• Diamond Block §7→ Sanctuary Waypoint"
      );
    }

    form.button("§3Rename this waypoint");
    actions.push(() => showNameForm(player, key, true));

    const res = await showForm(player, form);
    if (!res || res.canceled || res.selection === undefined) return;
    const action = actions[res.selection];
    if (action) action();
  } catch (e) {
    reportError(player, e);
  }
}

// ---------------------------------------------------------------------------
// Teleport
// ---------------------------------------------------------------------------

function teleportTo(player, source, wp) {
  try {
    // Both ends must still be Teleport Waypoints at the moment of travel.
    if (liveModeFor(source) !== MODE_TELEPORT) {
      player.sendMessage("§cThis monument is no longer a Teleport Waypoint — it needs a Redstone Block beneath it.");
      return;
    }

    const dim = world.getDimension(wp.dim);
    const blockThere = tryGetBlock(dim, wp);
    if (blockThere) {
      if (blockThere.typeId !== BLOCK_ID) {
        pruneWaypoint(wp.key);
        player.sendMessage(`§cWaypoint "§f${wp.name}§c" no longer exists — removed from the list.`);
        return;
      }
      const targetMode = syncBlockMode(blockThere).mode;
      updateWaypointMode(wp.key, targetMode);
      if (targetMode !== MODE_TELEPORT) {
        player.sendMessage(`§cWaypoint "§f${wp.name}§c" has no Redstone Block beneath it and cannot receive travellers.`);
        return;
      }
    }

    if (!chargeLevels(player, TELEPORT_COST, "Teleporting")) return;

    stopBlackWingsFlight(player);
    player.teleport({ x: wp.x + 0.5, y: wp.y + 1, z: wp.z + 0.5 }, { dimension: dim });
    player.sendMessage(`§bWarped to "§f${wp.name}§b".`);
    player.playSound("mob.shulker.teleport");

    // The chunk is loaded now that the player arrived — verify the monument
    // and its activator survived, and fix the registry if they did not.
    system.runTimeout(() => {
      try {
        const check = tryGetBlock(dim, wp);
        if (!check) return;
        if (check.typeId !== BLOCK_ID) {
          pruneWaypoint(wp.key);
          player.sendMessage(`§cThe monument at "§f${wp.name}§c" was destroyed — waypoint removed.`);
          return;
        }
        const arrivedMode = syncBlockMode(check).mode;
        updateWaypointMode(wp.key, arrivedMode);
        if (arrivedMode !== MODE_TELEPORT) {
          player.sendMessage(`§eThe Redstone Block beneath "§f${wp.name}§e" is gone — it can no longer be reached from other waypoints.`);
        }
      } catch {}
    }, 10);
  } catch (e) {
    reportError(player, e);
  }
}

// A Teleport Waypoint used under the Slow Falling effect leads to The Deep Sky
// instead of another monument; the way back is the potion running out.
function enterDeepSkyFrom(player, source) {
  try {
    if (liveModeFor(source) !== MODE_TELEPORT) {
      player.sendMessage("§cThis monument is no longer a Teleport Waypoint — it needs a Redstone Block beneath it.");
      return;
    }
    if (!hasEntryEffect(player)) {
      player.sendMessage("§cThe Slow Falling has already worn off.");
      return;
    }
    if (!chargeLevels(player, TELEPORT_COST, "Teleporting")) return;
    enterDeepSky(player, {
      ox: source.x,
      oy: source.y,
      oz: source.z,
      odim: source.dim,
      oname: source.name || `Waypoint ${source.x}, ${source.z}`
    });
  } catch (e) {
    reportError(player, e);
  }
}

// ---------------------------------------------------------------------------
// Enchanting
// ---------------------------------------------------------------------------

function enchantAt(player, wp) {
  try {
    if (distanceTo(player, wp) > INTERACT_RANGE) {
      player.sendMessage("§cYou are too far from the waypoint.");
      return;
    }
    // Re-check the activator: the Lapis block must be present at this instant.
    if (liveModeFor(wp) !== MODE_ENCHANT) {
      player.sendMessage("§cAn Enchanting Waypoint needs a Lapis Lazuli Block directly beneath it.");
      return;
    }
    // Levels are only taken once something was actually enchanted.
    if (!isCreative(player) && player.level < ENCHANT_COST) {
      player.sendMessage(`§cEnchanting costs §f${ENCHANT_COST} levels§c — you have ${player.level}.`);
      return;
    }

    const result = enchantHeldItem(player);
    switch (result.status) {
      case "no_item":
      case "not_enchantable":
        player.sendMessage("§eNo enchantable item in your hand.");
        return;
      case "maxed":
        player.sendMessage("§eThis item already has the maximum enchantments.");
        return;
      case "nothing_applicable":
        player.sendMessage("§eNone of this waypoint's enchantments can be applied to that item.");
        return;
      case "error": {
        const first = result.failed[0];
        reportError(player, `${first.label}: ${first.error}`);
        player.sendMessage("§cEnchanting failed — your item was left unchanged.");
        return;
      }
      case "enchanted": {
        chargeLevels(player, ENCHANT_COST, "Enchanting");
        const lines = [...result.applied, ...result.upgraded].map((r) => r.label);
        player.sendMessage(`§aEnchanting complete! §7(${lines.length} enchantment${lines.length === 1 ? "" : "s"})`);
        player.sendMessage(`§7${lines.join("§8, §7")}`);
        if (result.failed && result.failed.length > 0) {
          player.sendMessage(`§eCould not apply: §7${result.failed.map((f) => f.label).join("§8, §7")}`);
        }
        try {
          player.playSound("random.levelup");
          const dim = world.getDimension(wp.dim);
          dim.spawnParticle("wp:lapis_halo", { x: player.location.x, y: player.location.y + 0.8, z: player.location.z });
        } catch {}
        return;
      }
    }
  } catch (e) {
    reportError(player, e);
  }
}
