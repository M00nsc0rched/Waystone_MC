import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const plansSource = readFileSync(new URL("../WaypointMonuments_BP/scripts/building-plans.js", import.meta.url), "utf8");
const plans = await import(`data:text/javascript;base64,${Buffer.from(plansSource).toString("base64")}`);
const runtimeSource = readFileSync(new URL("../WaypointMonuments_BP/scripts/buildings.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace("export function initBuildings", "function initBuildings");

function signal() {
  const listeners = [];
  return {
    subscribe(listener) { listeners.push(listener); },
    fire(event) { for (const listener of listeners) listener(event); }
  };
}

class Permutation {
  constructor(id, states = {}) { this.type = { id }; this.states = { ...states }; }
  getAllStates() { return { ...this.states }; }
  getState(name) { return this.states[name]; }
  withState(name, value) { return new Permutation(this.type.id, { ...this.states, [name]: value }); }
  matches(id, states = {}) {
    return id === this.type.id && Object.entries(states).every(([key, value]) => this.states[key] === value);
  }
  static resolve(id) {
    if (id.endsWith("_fence")) return new Permutation(id, {
      "minecraft:connection_east": false, "minecraft:connection_west": false,
      "minecraft:connection_north": false, "minecraft:connection_south": false
    });
    return new Permutation(id);
  }
}

function harness({ fullInventory = false } = {}) {
  const data = new Map();
  const writes = [];
  const jobs = [];
  const scheduled = [];
  const intervals = [];
  const messages = [];
  const forms = [];
  const properties = new Map();
  const inventory = Array(36).fill(undefined);
  const anchor = { x: 0, y: 1, z: 0 };
  const key = (p) => `${p.x},${p.y},${p.z}`;
  let unloaded = () => false;
  const dimension = {
    id: "minecraft:overworld", heightRange: { min: -64, max: 320 },
    getPlayers() { return player.isValid ? [player] : []; },
    getBlock(location) {
      if (unloaded(location)) return undefined;
      return {
        location: { ...location }, dimension,
        get permutation() {
          return data.get(key(location)) ?? Permutation.resolve(location.y <= 0 ? "minecraft:grass_block" : "minecraft:air");
        },
        get typeId() { return this.permutation.type.id; },
        get isAir() { return this.typeId === "minecraft:air"; },
        get isLiquid() { return this.typeId === "minecraft:water" || this.typeId === "minecraft:lava"; },
        setPermutation(permutation) {
          const previous = this.permutation;
          data.set(key(location), permutation);
          writes.push({ location: { ...location }, permutation });
          if (["minecraft:tall_grass", "minecraft:large_fern"].includes(previous.type.id) && previous.type.id !== permutation.type.id) {
            const companion = { ...location, y: location.y + (previous.getState("upper_block_bit") ? -1 : 1) };
            if (data.get(key(companion))?.type.id === previous.type.id) data.set(key(companion), Permutation.resolve("minecraft:air"));
          }
          if (["minecraft:tall_grass", "minecraft:large_fern"].includes(permutation.type.id)) {
            const upper = permutation.getState("upper_block_bit");
            const companion = { ...location, y: location.y + (upper ? -1 : 1) };
            const other = data.get(key(companion))?.type.id ?? "minecraft:air";
            if ((upper && other !== permutation.type.id) || (!upper && other !== "minecraft:air" && other !== permutation.type.id)) {
              data.set(key(location), Permutation.resolve("minecraft:air"));
            }
          }
        }
      };
    }
  };
  const player = {
    id: "test-player", isValid: true, selectedSlotIndex: 0, isSneaking: false,
    location: { x: 0, y: 1, z: 2 }, dimension,
    getViewDirection() { return { x: 0, y: 0, z: -1 }; },
    getDynamicProperty(name) { return properties.get(name); },
    setDynamicProperty(name, value) { properties.set(name, value); },
    getComponent(name) {
      if (name !== "minecraft:inventory") return undefined;
      return { container: {
        size: inventory.length,
        getItem(index) { return inventory[index]; },
        setItem(index, value) { inventory[index] = value; }
      } };
    },
    sendMessage(message) { messages.push(message); },
    playSound() {}
  };
  if (fullInventory) {
    for (let i = 0; i < inventory.length; i++) inventory[i] = { typeId: "minecraft:stone", amount: i + 1 };
  }
  data.set(key(anchor), new Permutation("wp:building_planner", { "wp:heading": "north" }));
  const afterEvents = Object.fromEntries([
    "playerPlaceBlock", "playerInteractWithBlock", "playerBreakBlock", "playerLeave", "playerSpawn"
  ].map((name) => [name, signal()]));
  const startup = signal();
  const system = {
    beforeEvents: { startup },
    run(callback) { scheduled.push(callback); },
    runTimeout(callback) { scheduled.push(callback); },
    runInterval(callback) { intervals.push(callback); },
    runJob(generator) { jobs.push(generator); return jobs.length; }
  };
  const selections = [];
  class Form {
    constructor() { this.buttons = []; }
    title(text) { this.titleText = text; return this; }
    body(text) { this.bodyText = text; return this; }
    button(text) { this.buttons.push(text); return this; }
    show() { forms.push(this); return Promise.resolve({ canceled: false, selection: selections.shift() ?? 2 }); }
  }
  class Stack {
    constructor(typeId, amount) { this.typeId = typeId; this.amount = amount; }
    setLore(lore) { this.lore = lore; }
  }
  vm.runInNewContext(`${runtimeSource}\ninitBuildings();`, {
    ...plans, BlockPermutation: Permutation, ItemStack: Stack, system,
    world: { afterEvents, getAllPlayers: () => player.isValid ? [player] : [] },
    ActionFormData: Form, FormCancelationReason: { UserBusy: "UserBusy" }, console
  });
  startup.fire({ blockComponentRegistry: { registerCustomComponent() {} } });
  function flushScheduled() {
    const batch = scheduled.splice(0);
    for (const callback of batch) callback();
  }
  function stepUntil(predicate, max = 200000) {
    for (let i = 0; jobs.length && !predicate(); i++) {
      assert.ok(i < max, "job must be bounded");
      if (jobs[0].next().done) jobs.shift();
    }
  }
  async function choose(kind = "castle") {
    selections.push(kind === "castle" ? 0 : 1);
    afterEvents.playerPlaceBlock.fire({ player, block: dimension.getBlock(anchor) });
    flushScheduled();
    await Promise.resolve();
  }
  return {
    anchor, data, writes, jobs, scheduled, intervals, messages, forms, properties, inventory,
    player, dimension, afterEvents, choose, flushScheduled, stepUntil,
    drain() { stepUntil(() => false); },
    setBlock(location, id) { data.set(key(location), Permutation.resolve(id)); },
    unload(predicate) { unloaded = predicate; },
    cancel() {
      player.isSneaking = true;
      afterEvents.playerInteractWithBlock.fire({ player, block: dimension.getBlock(anchor), isFirstEvent: true });
    }
  };
}

test("both blueprints fit their advertised bounds and retain accessible center entrances", () => {
  for (const [kind, spec] of Object.entries(plans.BUILDING_SPECS)) {
    const plan = plans.makeBuildingPlan(kind);
    assert.ok(plan.blocks.size > 3500, `${kind} should be a substantial building`);
    for (const entry of plan.blocks.values()) {
      assert.ok(entry.x >= 0 && entry.x < spec.width);
      assert.ok(entry.y >= 0 && entry.y < spec.height);
      assert.ok(entry.z >= 0 && entry.z < spec.depth);
    }
    const center = Math.floor(spec.width / 2);
    const end = kind === "castle" ? 23 : 27;
    for (let z = 0; z <= end; z++) {
      assert.ok(plan.blocks.has(`${center},0,${z}`), `${kind} approach has a floor at ${z}`);
      assert.ok(!plan.blocks.has(`${center},1,${z}`), `${kind} approach has foot clearance at ${z}`);
      assert.ok(!plan.blocks.has(`${center},2,${z}`), `${kind} approach has head clearance at ${z}`);
    }
    assert.equal(plan.blocks.size, plans.makeBuildingPlan(kind).blocks.size);
  }
});

test("every orientation puts the full footprint ahead of the planner without duplicate cells", () => {
  const anchor = { x: 5, y: 70, z: -9 };
  for (const [heading, forward] of Object.entries({
    north: { x: 0, z: -1 }, east: { x: 1, z: 0 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 }
  })) {
    assert.equal(plans.headingFromView(forward), heading);
    const visited = new Set();
    for (let z = 0; z < 35; z++) {
      for (let x = 0; x < 23; x++) {
        const p = plans.buildingLocation(anchor, heading, 23, x, 0, z);
        assert.equal((p.x - anchor.x) * forward.x + (p.z - anchor.z) * forward.z, z + 3);
        visited.add(`${p.x},${p.z}`);
      }
    }
    assert.equal(visited.size, 23 * 35);
  }
});

test("an occupied volume is rejected before any construction write", async () => {
  const h = harness();
  const protectedCell = plans.buildingLocation(h.anchor, "north", 27, 13, 2, 20);
  h.setBlock(protectedCell, "minecraft:chest");
  await h.choose();
  h.writes.length = 0; // Placement only updates the planner's heading.
  h.drain();
  assert.equal(h.dimension.getBlock(protectedCell).typeId, "minecraft:chest");
  assert.equal(h.writes.length, 0);
  assert.ok(h.messages.some((text) => text.includes("Akadály")));
});

test("missing support rejects a cathedral without leaving a floating platform", async () => {
  const h = harness();
  h.setBlock(plans.buildingLocation(h.anchor, "north", 23, 10, -1, 20), "minecraft:air");
  await h.choose("cathedral");
  h.writes.length = 0;
  h.drain();
  assert.equal(h.writes.length, 0);
  assert.ok(h.messages.some((text) => text.includes("Hiányzó talaj")));
});

test("both buildings finish with the expected blocks, keeping the planner reusable", async () => {
  for (const kind of ["castle", "cathedral"]) {
    const h = harness();
    await h.choose(kind);
    h.writes.length = 0;
    h.drain();
    const plan = plans.makeBuildingPlan(kind);
    assert.equal(h.writes.length, plan.blocks.size);
    for (const entry of plan.blocks.values()) {
      const p = plans.buildingLocation(h.anchor, "north", plan.width, entry.x, entry.y, entry.z);
      assert.equal(h.dimension.getBlock(p).typeId, entry.type);
    }
    assert.equal(h.dimension.getBlock(h.anchor).typeId, "wp:building_planner");
    assert.ok(h.messages.some((text) => text.includes(`Elkészült: ${plan.name}`)));
  }
});

test("cancellation restores constructed cells and preserves a concurrent player edit", async () => {
  const h = harness();
  await h.choose();
  h.writes.length = 0;
  h.stepUntil(() => h.writes.length >= 40);
  const placed = h.writes.map((entry) => entry.location);
  const edited = placed[10];
  h.setBlock(edited, "minecraft:diamond_block");
  h.cancel();
  h.drain();
  for (const p of placed) {
    assert.equal(h.dimension.getBlock(p).typeId, p === edited ? "minecraft:diamond_block" : "minecraft:air");
  }
  assert.ok(h.messages.some((text) => text.includes("visszaállítottuk")));
});

test("rollback waits for unloaded cells and completes when the area loads again", async () => {
  const h = harness();
  await h.choose();
  h.writes.length = 0;
  h.stepUntil(() => h.writes.length >= 30);
  const first = h.writes[0].location;
  h.unload((p) => p.x === first.x && p.y === first.y && p.z === first.z);
  h.cancel();
  h.drain();
  assert.ok(h.scheduled.length > 0);
  assert.ok(h.messages.some((text) => text.includes("betöltésekor folytatódik")));
  h.unload(() => false);
  h.flushScheduled();
  h.drain();
  assert.equal(h.dimension.getBlock(first).typeId, "minecraft:air");
  assert.ok(h.messages.some((text) => text.includes("visszaállítottuk")));
});

test("tall plants restore both halves after an implicit removal or a later wall placement", async () => {
  for (const afterWall of [false, true]) {
    const h = harness();
    const lower = plans.buildingLocation(h.anchor, "north", 27, 1, 0, 1);
    const upper = { ...lower, y: lower.y + 1 };
    h.data.set(`${lower.x},${lower.y},${lower.z}`, new Permutation("minecraft:tall_grass", { upper_block_bit: false }));
    h.data.set(`${upper.x},${upper.y},${upper.z}`, new Permutation("minecraft:tall_grass", { upper_block_bit: true }));
    await h.choose();
    h.writes.length = 0;
    const target = afterWall ? upper : lower;
    h.stepUntil(() => h.writes.some((entry) => entry.location.x === target.x && entry.location.y === target.y && entry.location.z === target.z));
    if (!afterWall) assert.equal(h.dimension.getBlock(upper).typeId, "minecraft:air", "engine physics removed the companion half");
    else assert.equal(h.dimension.getBlock(upper).typeId, "minecraft:stone_bricks");
    h.cancel();
    h.drain();
    assert.equal(h.dimension.getBlock(lower).permutation.getState("upper_block_bit"), false);
    assert.equal(h.dimension.getBlock(upper).permutation.getState("upper_block_bit"), true);
  }
});

test("rollback recognizes fences after their connection states are recalculated", async () => {
  const h = harness();
  await h.choose();
  h.writes.length = 0;
  h.stepUntil(() => h.writes.some((entry) => entry.permutation.type.id === "minecraft:dark_oak_fence"));
  const fence = h.writes.find((entry) => entry.permutation.type.id === "minecraft:dark_oak_fence");
  h.data.set(`${fence.location.x},${fence.location.y},${fence.location.z}`, fence.permutation.withState("minecraft:connection_east", true));
  h.cancel();
  h.drain();
  assert.equal(h.dimension.getBlock(fence.location).typeId, "minecraft:air");
});

test("a blueprint can reach the exclusive dimension height limit exactly", async () => {
  const h = harness();
  h.dimension.heightRange.max = h.anchor.y + plans.BUILDING_SPECS.castle.height;
  await h.choose();
  h.writes.length = 0;
  h.drain();
  assert.ok(h.messages.some((text) => text.includes("Elkészült: Vár")));
});

test("planner gold trim uses valid per-face materials and texture bounds", () => {
  const geometry = JSON.parse(readFileSync(new URL("../WaypointMonuments_RP/models/blocks/wp_building_planner.geo.json", import.meta.url), "utf8"))["minecraft:geometry"][0];
  for (const bone of geometry.bones) {
    for (const cube of bone.cubes) {
      assert.equal(cube.material_instance, undefined);
      assert.equal(Object.keys(cube.uv).length, 6);
      for (const face of Object.values(cube.uv)) {
        assert.ok(face.uv[0] >= 0 && face.uv[0] + face.uv_size[0] <= geometry.description.texture_width);
        assert.ok(face.uv[1] >= 0 && face.uv[1] + face.uv_size[1] <= geometry.description.texture_height);
        if (bone.name === "gold_edges") assert.equal(face.material_instance, "trim");
      }
    }
  }
});

test("delivery waits for inventory space, then puts the planner in hand without losing the held stack", () => {
  const h = harness({ fullInventory: true });
  const previousHeld = h.inventory[0];
  h.flushScheduled();
  assert.equal(h.messages.length, 1);
  for (const interval of h.intervals) interval();
  assert.equal(h.messages.length, 1, "a full inventory does not cause notification spam");
  h.inventory[15] = undefined;
  for (const interval of h.intervals) interval();
  assert.equal(h.inventory[0].typeId, "wp:building_planner");
  assert.equal(h.inventory[15], previousHeld);
  h.afterEvents.playerSpawn.fire({ player: h.player, initialSpawn: true });
  h.flushScheduled();
  assert.equal(h.inventory.filter((item) => item?.typeId === "wp:building_planner").length, 1);
});
