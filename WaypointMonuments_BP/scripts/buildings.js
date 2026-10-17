import { BlockPermutation, ItemStack, system, world } from "@minecraft/server";
import { ActionFormData, FormCancelationReason } from "@minecraft/server-ui";
import { BUILDING_SPECS, buildingLocation, headingFromView, makeBuildingPlan } from "./building-plans.js";

const PLANNER_ID = "wp:building_planner";
const MENU_COMPONENT = "wp:building_planner_menu";
const GIVEN_PROPERTY = "wp:building_planner_given_v1";
const AIR = "minecraft:air";
const FORM_RANGE = 8;
const BUILD_RANGE = 64;
const REPLACEABLE = new Set([
  AIR, "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern",
  "minecraft:large_fern", "minecraft:deadbush", "minecraft:snow_layer",
  "minecraft:dandelion", "minecraft:poppy", "minecraft:blue_orchid",
  "minecraft:allium", "minecraft:azure_bluet", "minecraft:red_tulip",
  "minecraft:orange_tulip", "minecraft:white_tulip", "minecraft:pink_tulip",
  "minecraft:oxeye_daisy", "minecraft:cornflower", "minecraft:lily_of_the_valley",
  // Older worlds may still expose the pre-split plant identifiers.
  "minecraft:tallgrass", "minecraft:red_flower", "minecraft:yellow_flower"
]);
const DOUBLE_PLANTS = new Set(["minecraft:tall_grass", "minecraft:large_fern"]);

let initialized = false;
// Serialize builds across the world to bound work and prevent intersecting jobs.
let activeBuild;
const openForms = new Set();
const pendingDeliveries = new Set();
const deliveryNotices = new Set();

function say(player, message) {
  try { player.sendMessage(`§b[Építész] §r${message}`); } catch {}
}

function readBlock(dimension, location) {
  try { return dimension.getBlock(location); } catch { return undefined; }
}

function sameLocation(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function samePermutation(block, permutation) {
  const states = permutation.getAllStates();
  // Fence connections are recalculated as neighboring cells are placed. They
  // must not make rollback mistake one of our own fences for a player edit.
  for (const name of Object.keys(states)) {
    if (name.startsWith("minecraft:connection_") || name.startsWith("wall_connection_")) delete states[name];
  }
  return block.permutation.matches(permutation.type.id, states);
}

function plannerExists(dimension, location) {
  return readBlock(dimension, location)?.typeId === PLANNER_ID;
}

function availableAtPlanner(player, dimension, location) {
  return player.isValid && player.dimension.id === dimension.id &&
    distanceSquared(player.location, location) <= FORM_RANGE ** 2 &&
    plannerExists(dimension, location);
}

function givePlanner(player) {
  try {
    if (player.getDynamicProperty(GIVEN_PROPERTY)) {
      pendingDeliveries.delete(player.id);
      return;
    }
    pendingDeliveries.add(player.id);
    const container = player.getComponent("minecraft:inventory")?.container;
    if (!container) return;
    // An already obtained planner counts as delivery (including reloads).
    for (let i = 0; i < container.size; i++) {
      if (container.getItem(i)?.typeId === PLANNER_ID) {
        player.setDynamicProperty(GIVEN_PROPERTY, true);
        pendingDeliveries.delete(player.id);
        return;
      }
    }
    let empty = -1;
    for (let i = 0; i < container.size; i++) {
      if (!container.getItem(i)) { empty = i; break; }
    }
    if (empty < 0) {
      if (!deliveryNotices.has(player.id)) {
        deliveryNotices.add(player.id);
        say(player, "§eA tervezőasztalhoz szabad hely kell a leltárban. Szabadíts fel egy helyet; néhány másodpercen belül megkapod. Könyv + papír + iránytű recepttel is készíthető.");
      }
      return;
    }
    const planner = new ItemStack(PLANNER_ID, 1);
    planner.setLore(["§7Tedd le, majd válassz: Vár vagy Katedrális.", "§7Újra használható. Guggolva használva: megszakítás."]);
    if (empty < 9) {
      container.setItem(empty, planner);
      player.selectedSlotIndex = empty;
    } else {
      // Preserve the held stack by moving it into the available inventory slot.
      const selected = player.selectedSlotIndex;
      const previous = container.getItem(selected);
      container.setItem(empty, previous);
      try {
        container.setItem(selected, planner);
      } catch (error) {
        container.setItem(empty, undefined);
        throw error;
      }
    }
    player.setDynamicProperty(GIVEN_PROPERTY, true);
    pendingDeliveries.delete(player.id);
    deliveryNotices.delete(player.id);
    say(player, "§aTervezőasztalt kaptál a kezedbe. Tedd le egy nagy, sík, üres terület elé, majd válassz épületet. A bejárat feléd néz.");
  } catch (error) {
    console.warn(`[Waypoint Buildings] Planner delivery failed: ${error}`);
  }
}

function footprintBounds(context) {
  const a = buildingLocation(context.anchor, context.heading, context.plan.width, 0, 0, 0);
  const b = buildingLocation(context.anchor, context.heading, context.plan.width,
    context.plan.width - 1, context.plan.height - 1, context.plan.depth - 1);
  return {
    minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x) + 1,
    minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) + 1,
    minY: a.y, maxY: b.y + 1
  };
}

function assertControl(context) {
  if (context.cancelled) throw new Error("Az építkezést megszakítottad.");
  if (!context.player.isValid || context.player.dimension.id !== context.dimension.id ||
      distanceSquared(context.player.location, context.anchor) > BUILD_RANGE ** 2) {
    throw new Error("Az építkezés leállt, mert a játékos eltávolodott vagy kilépett.");
  }
  if (!plannerExists(context.dimension, context.anchor)) {
    throw new Error("Az építkezés leállt, mert a tervezőasztal eltűnt vagy nincs betöltve.");
  }
  const b = context.bounds;
  for (const player of context.dimension.getPlayers()) {
    const p = player.location;
    if (p.x + 0.3 > b.minX && p.x - 0.3 < b.maxX &&
        p.z + 0.3 > b.minZ && p.z - 0.3 < b.maxZ &&
        p.y + 1.8 > b.minY && p.y < b.maxY) {
      throw new Error("Játékos van az építési területen. Lépjetek ki a kijelölt alaprajzból, majd próbáld újra.");
    }
  }
}

function blockOrFail(context, location) {
  const block = readBlock(context.dimension, location);
  if (!block) throw new Error(`A terület nincs betöltve (${location.x}, ${location.y}, ${location.z}). Maradj az asztal közelében.`);
  return block;
}

function finish(context) {
  if (activeBuild === context) activeBuild = undefined;
}

function recordChange(context, change) {
  const key = `${change.location.x},${change.location.y},${change.location.z}`;
  const previous = context.undoByLocation.get(key);
  if (previous) previous.placed = change.placed;
  else {
    const entry = { ...change };
    context.undoByLocation.set(key, entry);
    context.undo.push(entry);
  }
}

function recordPlantCompanion(context, change, air) {
  if (!DOUBLE_PLANTS.has(change.original.type.id)) return;
  const upper = change.original.getState("upper_block_bit") === true;
  const location = { ...change.location, y: change.location.y + (upper ? -1 : 1) };
  const companion = readBlock(context.dimension, location);
  if (companion?.typeId !== change.original.type.id) return;
  // Removing either half can remove the other before the next generator step.
  // Journal that implicit change now, including cancellation at this very step.
  recordChange(context, { location, original: companion.permutation, placed: air });
}

// Rollback touches only cells still matching what this job placed. A player
// edit made during construction is preserved. Unloaded cells are retried after
// one second, without loading chunks or forcing the player to remain online.
function* restoreBuild(context) {
  const retry = [];
  const plants = [];
  const air = BlockPermutation.resolve(AIR);
  // Lower halves must be back before their upper halves are restored.
  const changes = context.undo.slice().sort((a, b) => a.location.y - b.location.y);
  for (const change of changes) {
    const block = readBlock(context.dimension, change.location);
    if (!block) {
      retry.push(change);
    } else {
      try {
        if (samePermutation(block, change.placed)) {
          if (change.original.type.id !== AIR && REPLACEABLE.has(change.original.type.id)) {
            // Clear every constructed block before restoring plants, so that
            // a new wall in an upper-half cell cannot break its lower half.
            if (!block.isAir) block.setPermutation(air);
            plants.push({ ...change, placed: air });
          } else block.setPermutation(change.original);
        }
      } catch {
        retry.push(change);
      }
    }
    yield;
  }
  for (const change of plants) {
    const block = readBlock(context.dimension, change.location);
    if (!block) retry.push(change);
    else {
      try {
        if (block.isAir) block.setPermutation(change.original);
      } catch {
        retry.push(change);
      }
    }
    yield;
  }
  context.undo = retry;
  if (retry.length > 0) {
    if (!context.waitingReported) {
      context.waitingReported = true;
      say(context.player, "§eA visszaállítás a terület betöltésekor folytatódik. Az érintett környékre visszatérve automatikusan befejeződik.");
    }
    system.runTimeout(() => system.runJob(restoreBuild(context)), 20);
    return;
  }
  say(context.player, "§7Az építkezés változtatásait visszaállítottuk; a tervezőasztal újra használható.");
  finish(context);
}

function* construct(context) {
  try {
    const { plan, dimension, anchor, heading } = context;
    const range = dimension.heightRange;
    if (anchor.y - 1 < range.min || anchor.y + plan.height > range.max) {
      throw new Error("Az épület nem fér el a dimenzió magassági határain belül.");
    }
    const palette = new Map([AIR, ...plan.materials].map((id) => [id, BlockPermutation.resolve(id)]));
    const pending = [];
    let checked = 0;
    assertControl(context);
    // A complete preflight runs before the first write: the entire footprint
    // must have support, and the whole bounding volume must be air or plants.
    for (let z = 0; z < plan.depth; z++) {
      for (let x = 0; x < plan.width; x++) {
        if (checked++ % 128 === 0) assertControl(context);
        const supportLocation = buildingLocation(anchor, heading, plan.width, x, -1, z);
        const support = blockOrFail(context, supportLocation);
        if (support.isAir || support.isLiquid || REPLACEABLE.has(support.typeId)) {
          throw new Error(`Sík, összefüggő talaj kell az egész ${plan.width} × ${plan.depth} terület alatt. Hiányzó talaj: ${supportLocation.x}, ${supportLocation.y}, ${supportLocation.z}.`);
        }
        yield;
      }
    }
    for (let y = 0; y < plan.height; y++) {
      for (let z = 0; z < plan.depth; z++) {
        for (let x = 0; x < plan.width; x++) {
          if (checked++ % 128 === 0) assertControl(context);
          const location = buildingLocation(anchor, heading, plan.width, x, y, z);
          const block = blockOrFail(context, location);
          if (!REPLACEABLE.has(block.typeId)) {
            throw new Error(`Akadály az építési területen: ${location.x}, ${location.y}, ${location.z} (${block.typeId}). Az építkezés nem ír felül meglévő blokkokat.`);
          }
          const type = plan.blocks.get(`${x},${y},${z}`)?.type ?? AIR;
          if (type !== AIR || !block.isAir) {
            pending.push({ location, original: block.permutation, placed: palette.get(type) });
          }
          yield;
        }
      }
    }
    context.phase = "building";
    say(context.player, `§aA terület szabad. Épül: ${plan.name}. Maradj a tervezőasztalnál; megszakítás: guggolás + használat.`);
    let written = 0;
    for (const change of pending) {
      if (context.cancelled || written % 32 === 0) assertControl(context);
      const block = blockOrFail(context, change.location);
      // Breaking a tall plant may automatically remove its other half.
      const plantDisappeared = block.isAir && REPLACEABLE.has(change.original.type.id);
      if (!samePermutation(block, change.original) && !plantDisappeared) {
        throw new Error(`A terület megváltozott: ${change.location.x}, ${change.location.y}, ${change.location.z}. Az építkezés leállt a módosítás védelmében.`);
      }
      if (!samePermutation(block, change.placed)) {
        // Record before the write so that a failure cannot lose the undo entry.
        recordChange(context, change);
        recordPlantCompanion(context, change, palette.get(AIR));
        block.setPermutation(change.placed);
      }
      written++;
      yield;
    }
    say(context.player, `§aElkészült: ${plan.name}! §7A tervezőasztal ismét használható, és kiásva magaddal viheted.`);
    try { context.player.playSound("random.levelup"); } catch {}
    finish(context);
  } catch (error) {
    say(context.player, `§e${error.message ?? error}`);
    if (context.undo.length > 0) {
      context.phase = "restoring";
      system.runJob(restoreBuild(context));
    } else finish(context);
  }
}

function startBuild(player, dimension, anchor, kind) {
  if (activeBuild) {
    say(player, "§eMár folyik egy építkezés vagy visszaállítás. Várd meg a befejezését.");
    return;
  }
  if (!availableAtPlanner(player, dimension, anchor)) return;
  const heading = readBlock(dimension, anchor).permutation.getState("wp:heading");
  const context = {
    player, dimension, anchor, heading, plan: makeBuildingPlan(kind),
    cancelled: false, phase: "checking", undo: [], undoByLocation: new Map()
  };
  context.bounds = footprintBounds(context);
  activeBuild = context;
  say(player, `§7Terület ellenőrzése: ${context.plan.name} (${context.plan.width} × ${context.plan.depth} × ${context.plan.height}).`);
  system.runJob(construct(context));
}

function requestMenu(player, dimension, anchor, attempts = 0) {
  if (openForms.has(player.id) && attempts === 0) return;
  if (!availableAtPlanner(player, dimension, anchor)) return;
  if (activeBuild) {
    if (activeBuild.player.id === player.id && activeBuild.dimension.id === dimension.id &&
        sameLocation(activeBuild.anchor, anchor) && activeBuild.phase !== "restoring") {
      if (player.isSneaking) {
        activeBuild.cancelled = true;
        say(player, "§eMegszakítás és visszaállítás folyamatban.");
      } else say(player, "§7Az építkezés folyamatban. Megszakítás: guggolás + használat az asztalon.");
    } else say(player, "§eMár folyik egy építkezés vagy visszaállítás. Várd meg a befejezését.");
    return;
  }
  openForms.add(player.id);
  const castle = BUILDING_SPECS.castle;
  const cathedral = BUILDING_SPECS.cathedral;
  new ActionFormData()
    .title("Építész tervezőasztal")
    .body("Válassz épületet! Az asztal lerakásakor nézett irányban, 3 blokkal előrébb épül, a bejárat feléd néz.\n\nSík, üres terület kell; a meglévő épületeket megőrzi. Maradj az asztal közelében, és ne lépj az alaprajzra. Az asztal újra használható.")
    .button(`Vár\n${castle.width} × ${castle.depth}, ${castle.height} blokk magas`)
    .button(`Katedrális\n${cathedral.width} × ${cathedral.depth}, ${cathedral.height} blokk magas`)
    .button("Mégse")
    .show(player)
    .then((result) => {
      if (result.canceled && result.cancelationReason === FormCancelationReason.UserBusy && attempts < 3) {
        system.runTimeout(() => {
          openForms.delete(player.id);
          requestMenu(player, dimension, anchor, attempts + 1);
        }, 10);
        return;
      }
      openForms.delete(player.id);
      if (result.canceled) {
        if (result.cancelationReason === FormCancelationReason.UserBusy) say(player, "§7Az épületválasztóhoz használd az asztalt.");
        return;
      }
      if (result.selection === 0 || result.selection === 1) {
        startBuild(player, dimension, anchor, result.selection === 0 ? "castle" : "cathedral");
      }
    })
    .catch((error) => {
      openForms.delete(player.id);
      say(player, "§eA menü nem nyitható meg. Használd újra a tervezőasztalt.");
      console.warn(`[Waypoint Buildings] Menu failed: ${error}`);
    });
}

export function initBuildings() {
  if (initialized) return;
  initialized = true;
  system.beforeEvents.startup.subscribe((event) => {
    event.blockComponentRegistry.registerCustomComponent(MENU_COMPONENT, {
      onPlayerInteract(interaction) {
        if (!interaction.player) return;
        const anchor = { ...interaction.block.location };
        system.run(() => requestMenu(interaction.player, interaction.dimension, anchor));
      }
    });
  });
  world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (event.block.typeId !== PLANNER_ID) return;
    const { block, player } = event;
    block.setPermutation(block.permutation.withState("wp:heading", headingFromView(player.getViewDirection())));
    const anchor = { ...block.location };
    const dimension = block.dimension;
    system.runTimeout(() => requestMenu(player, dimension, anchor), 5);
  });
  // Fallback also supports clients where the component interaction is omitted.
  world.afterEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.isFirstEvent === false || event.block.typeId !== PLANNER_ID) return;
    requestMenu(event.player, event.block.dimension, { ...event.block.location });
  });
  world.afterEvents.playerBreakBlock.subscribe((event) => {
    if (event.brokenBlockPermutation.type.id !== PLANNER_ID || !activeBuild) return;
    if (event.dimension.id === activeBuild.dimension.id && sameLocation(event.block.location, activeBuild.anchor)) {
      activeBuild.cancelled = true;
    }
  });
  world.afterEvents.playerLeave.subscribe((event) => {
    openForms.delete(event.playerId);
    pendingDeliveries.delete(event.playerId);
    deliveryNotices.delete(event.playerId);
    if (activeBuild?.player.id === event.playerId) activeBuild.cancelled = true;
  });
  world.afterEvents.playerSpawn.subscribe((event) => {
    if (event.initialSpawn) system.runTimeout(() => givePlanner(event.player), 20);
  });
  system.run(() => {
    for (const player of world.getAllPlayers()) givePlanner(player);
  });
  system.runInterval(() => {
    if (pendingDeliveries.size === 0) return;
    for (const player of world.getAllPlayers()) {
      if (pendingDeliveries.has(player.id)) givePlanner(player);
    }
  }, 100);
}
