// Run with: node --experimental-vm-modules tools/test-wings.cjs
// Execute the production modules against the stable server 2.0.0 API shape.
// These tests cover script behavior; Minecraft must verify collision/rendering.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scripts = path.resolve(__dirname, "../WaypointMonuments_BP/scripts");
const InputButton = { Jump: "Jump", Sneak: "Sneak" };
const ButtonState = { Pressed: "Pressed", Released: "Released" };
const EquipmentSlot = { Mainhand: "Mainhand", Chest: "Chest" };
const maxLevels = { protection: 4, unbreaking: 3, thorns: 3, mending: 1, sharpness: 5 };
const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected, message = "") => assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

class Item {
  constructor(data = {}, options = {}) {
    this.data = {
      typeId: "minecraft:netherite_chestplate", nameTag: "Old armor", amount: 1,
      lore: ["Family heirloom"], dynamic: { "other:owner": "Alex" },
      durability: 123, trim: { material: "gold", pattern: "silence" },
      dye: "#224466", keepOnDeath: true, lockMode: "inventory", enchants: {}, ...structuredClone(data)
    };
    this.options = options;
  }
  get typeId() { return this.data.typeId; }
  clone() { return new Item(this.data, this.options); }
  getLore() { return [...this.data.lore]; }
  setLore(lore) { assert(lore.length <= 20); this.data.lore = [...lore]; }
  getDynamicProperty(id) { return this.data.dynamic[id]; }
  setDynamicProperty(id, value) {
    if (this.options.propertyError) throw new Error("Dynamic property write failed");
    this.data.dynamic[id] = value;
  }
  getComponent(id) {
    if (id !== "minecraft:enchantable" || this.options.notEnchantable) return undefined;
    const item = this;
    const key = (type) => type.id.replace("minecraft:", "");
    return {
      slots: [],
      getEnchantment(type) {
        const level = item.data.enchants[key(type)];
        return level === undefined ? undefined : { type, level };
      },
      hasEnchantment(type) { return item.data.enchants[key(type)] !== undefined; },
      canAddEnchantment() { return true; },
      addEnchantment({ type, level }) { item.data.enchants[key(type)] = level; },
      removeEnchantment(type) { delete item.data.enchants[key(type)]; }
    };
  }
}

async function harness() {
  const warnings = [], intervals = [], scheduled = [], players = [], entities = [];
  const signals = Object.fromEntries(["playerButtonInput", "playerLeave", "entityDie", "playerSpawn"].map((name) => {
    const listeners = [];
    return [name, { subscribe: (callback) => listeners.push(callback), emit: (event) => listeners.forEach((callback) => callback(event)) }];
  }));
  let nextEntity = 0;
  const dimensions = new Map();
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    const dimension = {
      id, failSpawn: false,
      spawnEntity(typeId, location) {
        if (this.failSpawn) throw new Error("Entity unavailable");
        const entity = {
          id: `wing-${++nextEntity}`, typeId, location: { ...location }, dimension: this,
          isValid: true, properties: {}, propertyWrites: 0, removed: false,
          remove() { this.isValid = false; this.removed = true; },
          teleport(location, options) {
            if (!this.isValid) throw new Error("Invalid entity");
            this.location = { ...location }; this.dimension = options.dimension ?? this.dimension;
            this.rotation = { ...options.rotation };
          },
          setProperty(name, value) { this.properties[name] = value; this.propertyWrites++; }
        };
        entities.push(entity);
        return entity;
      },
      getEntities({ type }) { return entities.filter((entity) => entity.isValid && entity.dimension === this && entity.typeId === type); }
    };
    dimensions.set(id, dimension);
  }
  const system = {
    currentTick: 0,
    runInterval: (callback, every) => intervals.push({ callback, every }),
    run: (callback) => scheduled.push(callback)
  };
  const world = { afterEvents: signals, getAllPlayers: () => [...players], getDimension: (id) => dimensions.get(id) };
  const slots = ["ArmorHead", "ArmorTorso", "ArmorLegs", "ArmorFeet", "Sword", "Bow", "Crossbow", "Spear", "FishingRod", "Pickaxe", "Axe", "Shovel", "Hoe"];
  const api = {
    world, system, EquipmentSlot, InputButton, ButtonState,
    EnchantmentSlot: Object.fromEntries(slots.map((slot) => [slot, slot])),
    EnchantmentTypes: { get: (id) => {
      const bare = id.replace("minecraft:", "");
      return maxLevels[bare] ? { id: bare, maxLevel: maxLevels[bare] } : undefined;
    } }
  };
  const context = vm.createContext({ console: { warn: (message) => warnings.push(message) } });
  const cache = new Map();
  const apiModule = new vm.SyntheticModule(Object.keys(api), function () {
    for (const [name, value] of Object.entries(api)) this.setExport(name, value);
  }, { context });
  function moduleAt(filename) {
    if (!cache.has(filename)) cache.set(filename, new vm.SourceTextModule(fs.readFileSync(filename, "utf8"), { identifier: filename, context }));
    return cache.get(filename);
  }
  async function load(filename) {
    const module = moduleAt(path.join(scripts, filename));
    if (module.status === "unlinked") await module.link((specifier, referring) => {
      if (specifier === "@minecraft/server") return apiModule;
      assert(specifier.startsWith("."), `Unexpected import: ${specifier}`);
      return moduleAt(path.resolve(path.dirname(referring.identifier), specifier));
    });
    if (module.status === "linked") await module.evaluate();
    return module.namespace;
  }
  const flight = await load("black-wings.js");
  const enchantment = await load("wing-enchantment.js");
  const enchanting = await load("enchanting.js");
  flight.initBlackWings();
  function player(id = "player-1", chest = new Item({ dynamic: { "wp:black_wings": 1 } })) {
    const inventory = new Map([[EquipmentSlot.Chest, chest]]);
    const value = {
      id, typeId: "minecraft:player", isValid: true, location: { x: 0, y: 70, z: 0 },
      dimension: dimensions.get("minecraft:overworld"), yaw: 0, mode: "Survival", health: 20,
      isInWater: false, isSwimming: false, isSleeping: false, isSneaking: false, isFlying: false, isGliding: false,
      movement: { x: 0, y: 0 }, jumping: false, mount: undefined, velocity: { x: 0, y: 0, z: 0 },
      messages: [], actionBars: [], teleports: [], equipmentWrites: 0, commitResult: true, commitError: false,
      getGameMode() { return this.mode; },
      getRotation() { return { x: 0, y: this.yaw }; },
      getComponent(id) {
        if (id === "minecraft:health") return { currentValue: this.health };
        if (id === "minecraft:riding") return { entityRidingOn: this.mount };
        if (id === "minecraft:equippable") return {
          getEquipment: (slot) => inventory.get(slot)?.clone(),
          setEquipment: (slot, item) => {
            if (value.commitError) throw new Error("Equipment unavailable");
            if (!value.commitResult) return false;
            value.equipmentWrites++;
            if (item) inventory.set(slot, item.clone()); else inventory.delete(slot);
            return true;
          }
        };
      },
      inputInfo: {
        getMovementVector: () => ({ ...value.movement }),
        getButtonState: (button) => button === InputButton.Jump && value.jumping ? ButtonState.Pressed : ButtonState.Released
      },
      sendMessage(message) { this.messages.push(message); },
      onScreenDisplay: { setActionBar: (message) => value.actionBars.push(message) },
      tryTeleport(location, options) {
        this.teleports.push({ location: { ...location }, options: { ...options } });
        assert.equal(options.checkForBlocks, true, "Flight must check destination collisions");
        assert.equal(options.keepVelocity, false, "Flight must stop gravity/velocity");
        if (this.blocked?.(location)) return false;
        this.location = { ...location }; this.velocity = { x: 0, y: 0, z: 0 };
        return true;
      },
      applyImpulse() { throw new Error("Player.applyImpulse is unavailable in stable 2.0.0"); },
      clearVelocity() { throw new Error("Player.clearVelocity is unavailable in stable 2.0.0"); },
      addEffect() { throw new Error("Flight must not add effects or extend Deep Sky"); },
      setGameMode() { throw new Error("Flight must retain player game mode"); },
      runCommand() { throw new Error("Flight must not issue ability/effect/game-mode commands"); },
      equip: (slot, item) => item ? inventory.set(slot, item) : inventory.delete(slot),
      item: (slot) => inventory.get(slot)
    };
    players.push(value);
    return value;
  }
  function tick(count = 1) {
    for (let i = 0; i < count; i++) {
      system.currentTick++;
      for (const entry of intervals) if (system.currentTick % entry.every === 0) entry.callback();
      for (const callback of scheduled.splice(0)) callback();
    }
  }
  function press(player, button = InputButton.Jump) {
    player.jumping = button === InputButton.Jump;
    signals.playerButtonInput.emit({ player, button, newButtonState: ButtonState.Pressed });
  }
  function release(player) {
    player.jumping = false;
    signals.playerButtonInput.emit({ player, button: InputButton.Jump, newButtonState: ButtonState.Released });
  }
  function doubleJump(player) { press(player); release(player); tick(); press(player); release(player); tick(); }
  const wings = () => entities.filter((entity) => entity.isValid);
  return { flight, enchantment, enchanting, player, players, dimensions, signals, system, warnings, tick, press, release, doubleJump, wings };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test("movement obeys cardinal yaw, analog controls, normalized diagonals and vertical input", async () => {
  const { flight } = await harness();
  const expected = [[0, 0, 0.42], [90, -0.42, 0], [180, 0, -0.42], [-90, 0.42, 0]];
  for (const [yaw, x, z] of expected) {
    const delta = flight.flightStep({ x: 0, y: 1 }, yaw, false, false);
    close(delta.x, x); close(delta.z, z); close(delta.y, 0);
  }
  close(flight.flightStep({ x: 1, y: 0 }, 0, false, false).x, 0.42, "Left when facing south is east");
  close(flight.flightStep({ x: -1, y: 0 }, 90, false, false).z, -0.42, "Right when facing west is north");
  close(flight.flightStep({ x: 0, y: 0.5 }, 0, false, false).z, 0.21);
  const diagonal = flight.flightStep({ x: 1, y: 1 }, 0, true, false);
  close(Math.hypot(diagonal.x, diagonal.z), 0.42); close(diagonal.y, 0.30);
  close(flight.flightStep({ x: 0, y: 0 }, 0, false, true).y, -0.30);
  close(flight.flightStep({ x: 0, y: 0 }, 0, true, true).y, 0);
});

test("wearing an enchanted chestplate shows folded wings and only one help message", async () => {
  const h = await harness(); const p = h.player(); h.tick(3);
  assert.equal(h.wings().length, 1); assert.equal(h.wings()[0].properties["wp:flying"], false);
  assert.equal(h.wings()[0].propertyWrites, 1); assert.equal(p.messages.length, 1); assert.equal(p.teleports.length, 0);
  p.yaw = 80; p.location.x = 4; h.tick();
  assert.deepEqual(h.wings()[0].location, p.location); assert.equal(h.wings()[0].rotation.y, 80);
  assert.equal(h.warnings.length, 0);
});

test("only two jump presses inside the interval toggle flight; release and sneak do not", async () => {
  const h = await harness(); const p = h.player(); h.tick();
  h.press(p); h.release(p); h.tick(8); h.press(p); h.release(p); h.tick();
  assert.equal(h.wings()[0].properties["wp:flying"], false);
  h.press(p); h.release(p); h.tick(); assert.equal(h.wings()[0].properties["wp:flying"], true);
  h.press(p, InputButton.Sneak); h.release(p); h.tick(); assert.equal(h.wings()[0].properties["wp:flying"], true);
  h.doubleJump(p); assert.equal(h.wings()[0].properties["wp:flying"], false);
  assert.equal(h.warnings.length, 0);
});

test("hover counters gravity, movement substeps check collisions, and blocked axes slide", async () => {
  const h = await harness(); const p = h.player(); h.doubleJump(p);
  p.location.y -= 0.08; p.velocity.y = -0.08; h.tick();
  close(p.location.y, 70); close(p.velocity.y, 0);
  p.blocked = (location) => location.x > 0.1;
  p.movement = { x: 1, y: 1 }; p.teleports.length = 0; h.tick();
  close(p.location.x, 0); assert(p.location.z > 0);
  assert(p.teleports.some(({ location }) => location.x > 0.1), "Wall collision was attempted and rejected");
  assert(p.teleports.every(({ options }) => options.checkForBlocks && !options.keepVelocity));
  assert.equal(h.warnings.length, 0);
});

test("flight controls ascend, descend and preserve altitude when both vertical controls are held", async () => {
  const h = await harness(); const p = h.player(); h.doubleJump(p);
  p.jumping = true; h.tick(); close(p.location.y, 70.3);
  p.jumping = false; p.isSneaking = true; h.tick(); close(p.location.y, 70);
  p.jumping = true; h.tick(); close(p.location.y, 70);
});

test("removing armor removes wings and flight; re-equipping starts folded", async () => {
  const h = await harness(); const p = h.player(); const armor = p.item(EquipmentSlot.Chest);
  h.doubleJump(p); p.equip(EquipmentSlot.Chest, undefined); p.teleports.length = 0; h.tick();
  assert.equal(h.wings().length, 0); assert.equal(p.teleports.length, 0);
  p.equip(EquipmentSlot.Chest, armor); h.tick(); assert.equal(h.wings()[0].properties["wp:flying"], false);
});

test("leave, death, respawn and missed-leave cleanup discard old flight state", async () => {
  for (const event of ["playerLeave", "entityDie", "playerSpawn", "missing"]) {
    const h = await harness(); const p = h.player(); h.doubleJump(p); const old = h.wings()[0];
    if (event === "playerLeave") { h.players.length = 0; h.signals.playerLeave.emit({ playerId: p.id, playerName: "Alex" }); }
    if (event === "entityDie") { p.health = 0; h.signals.entityDie.emit({ deadEntity: p }); }
    if (event === "playerSpawn") h.signals.playerSpawn.emit({ player: p, initialSpawn: false });
    if (event === "missing") { h.players.length = 0; h.tick(); }
    assert.equal(old.isValid, false, event);
    if (!h.players.length) h.players.push(p);
    p.health = 20; p.teleports.length = 0; h.tick();
    assert.equal(h.wings()[0].properties["wp:flying"], false, event); assert.equal(p.teleports.length, 0, event);
  }
});

test("external and cross-dimension teleports keep their destination and stop scripted flight", async () => {
  for (const dimensionChange of [false, true]) {
    const h = await harness(); const p = h.player(); h.doubleJump(p);
    p.location = { x: 30, y: 130, z: -90 };
    if (dimensionChange) p.dimension = h.dimensions.get("minecraft:the_end");
    p.teleports.length = 0; h.tick();
    assert.equal(p.teleports.length, 0); assert.deepEqual(p.location, { x: 30, y: 130, z: -90 });
    assert.equal(h.wings()[0].properties["wp:flying"], false);
    assert.equal(h.wings()[0].dimension, p.dimension); assert.deepEqual(h.wings()[0].location, p.location);
  }
});

test("explicit flight release preserves short waypoint teleports and clears double-jump history", async () => {
  const h = await harness(); const p = h.player(); h.doubleJump(p);
  assert.equal(h.wings()[0].properties["wp:flying"], true);
  // Start a new double-jump sequence, then let a nearby waypoint interrupt it.
  h.press(p); h.release(p); h.tick();
  h.flight.stopBlackWingsFlight(p);
  p.location = { x: 1, y: 70, z: 0 }; p.teleports.length = 0; h.tick();
  assert.deepEqual(p.location, { x: 1, y: 70, z: 0 });
  assert.deepEqual(h.wings()[0].location, p.location);
  assert.equal(h.wings()[0].properties["wp:flying"], false);
  assert.equal(p.teleports.length, 0, "The old anchor must not pull the player back");
  h.press(p); h.release(p); h.tick();
  assert.equal(h.wings()[0].properties["wp:flying"], false, "The press before release must not count toward reactivation");
  h.press(p); h.release(p); h.tick();
  assert.equal(h.wings()[0].properties["wp:flying"], true, "A new double jump can activate from the destination");
  close(p.location.x, 1);
  assert.equal(h.warnings.length, 0);
});

test("water, swimming, sleeping and riding cancel flight and block activation", async () => {
  for (const flag of ["isInWater", "isSwimming", "isSleeping", "mount"]) {
    const h = await harness(); const p = h.player(); h.doubleJump(p);
    p[flag] = flag === "mount" ? { id: "boat" } : true; p.teleports.length = 0; h.tick();
    assert.equal(h.wings()[0].properties["wp:flying"], false, flag); assert.equal(p.teleports.length, 0, flag);
    h.doubleJump(p); assert.equal(h.wings()[0].properties["wp:flying"], false, flag);
  }
});

test("creative mode uses native flight, spectator hides wings, and ordinary armor has none", async () => {
  const h = await harness(); const p = h.player(); p.mode = "Creative"; p.isFlying = true;
  h.doubleJump(p); assert.equal(p.teleports.length, 0); assert.equal(h.wings()[0].properties["wp:flying"], true);
  p.mode = "Spectator"; h.tick(); assert.equal(h.wings().length, 0);
  p.mode = "Survival"; p.equip(EquipmentSlot.Chest, new Item()); h.doubleJump(p); assert.equal(h.wings().length, 0);
});

test("invalid visuals respawn, orphan cleanup preserves owned visuals, and spawn failures back off", async () => {
  const h = await harness(); const p = h.player(); h.tick();
  const old = h.wings()[0]; old.isValid = false; h.tick(); assert.equal(h.wings().length, 1); assert.notEqual(h.wings()[0].id, old.id);
  const owned = h.wings()[0]; const orphan = p.dimension.spawnEntity("wp:black_wings", p.location);
  h.tick(98); assert.equal(orphan.isValid, false); assert.equal(owned.isValid, true);
  owned.isValid = false; p.dimension.failSpawn = true; h.tick();
  assert.equal(h.warnings.length, 1); p.dimension.failSpawn = false; h.tick(99); assert.equal(h.wings().length, 0);
  h.tick(); assert.equal(h.wings().length, 1); assert.equal(h.warnings.length, 1);
});

test("maxed native armor still receives Black Wings once without losing any metadata", async () => {
  const h = await harness(); const p = h.player();
  const armor = new Item({ enchants: { protection: 4, unbreaking: 3, thorns: 3, mending: 1 } });
  const original = structuredClone(armor.data); p.equip(EquipmentSlot.Mainhand, armor);
  const result = h.enchanting.enchantHeldItem(p);
  assert.equal(result.status, "enchanted"); assert.equal(result.applied.length, 1); assert.equal(result.applied[0].id, "wp:black_wings");
  const updated = p.item(EquipmentSlot.Mainhand).data;
  assert.deepEqual(updated, { ...original, lore: [...original.lore, "§r§5Black Wings I"], dynamic: { ...original.dynamic, "wp:black_wings": 1 } });
  assert.deepEqual(armor.data, original, "Enchantment changes a copy rather than the inventory's original object");
  const again = h.enchanting.enchantHeldItem(p);
  assert.equal(again.status, "maxed"); assert.equal(p.equipmentWrites, 1); assert.equal(updated.lore.length, 2);
});

test("native armor upgrades and Black Wings commit together while retaining original stack data", async () => {
  const h = await harness(); const p = h.player(); const armor = new Item({ enchants: { protection: 1 }, nameTag: "Sentinel" });
  p.equip(EquipmentSlot.Mainhand, armor); const result = h.enchanting.enchantHeldItem(p);
  assert.equal(result.status, "enchanted"); assert.equal(result.upgraded[0].id, "protection");
  assert.equal(p.item(EquipmentSlot.Mainhand).data.enchants.protection, 4);
  assert.equal(p.item(EquipmentSlot.Mainhand).data.nameTag, "Sentinel");
  assert.deepEqual(p.item(EquipmentSlot.Mainhand).data.trim, armor.data.trim);
  assert.equal(h.enchantment.hasBlackWings(p.item(EquipmentSlot.Mainhand)), true);
});

test("full lore and failed dynamic-property writes never commit partially enchanted armor", async () => {
  for (const propertyError of [false, true]) {
    const h = await harness(); const p = h.player();
    const armor = new Item({ lore: propertyError ? ["Keep me"] : Array.from({ length: 20 }, (_, i) => `Lore ${i}`), enchants: { protection: 1 } }, { propertyError });
    const original = structuredClone(armor.data); p.equip(EquipmentSlot.Mainhand, armor);
    assert.equal(h.enchanting.enchantHeldItem(p).status, "error");
    assert.equal(p.equipmentWrites, 0); assert.deepEqual(p.item(EquipmentSlot.Mainhand).data, original);
  }
});

test("failed equipment commits report error, preserving the held item instead of reporting success", async () => {
  for (const commitError of [false, true]) {
    const h = await harness(); const p = h.player(); const armor = new Item(); const original = structuredClone(armor.data);
    p.equip(EquipmentSlot.Mainhand, armor); p.commitResult = false; p.commitError = commitError;
    const result = h.enchanting.enchantHeldItem(p);
    assert.equal(result.status, "error"); assert.equal(result.failed.at(-1).id, "equipment_commit");
    assert.equal(p.equipmentWrites, 0); assert.deepEqual(p.item(EquipmentSlot.Mainhand).data, original);
  }
});

test("decorative lore cannot grant flight and non-chestplate items cannot receive the custom enchantment", async () => {
  const h = await harness();
  const fake = new Item({ lore: ["§r§5Black Wings I"] });
  assert.equal(h.enchantment.hasBlackWings(fake), false);
  const boots = new Item({ typeId: "minecraft:netherite_boots", dynamic: { "wp:black_wings": 1 } });
  assert.equal(h.enchantment.hasBlackWings(boots), false); assert.equal(h.enchantment.addBlackWings(boots), undefined);
  const empty = h.player("empty"); assert.equal(h.enchanting.enchantHeldItem(empty).status, "no_item");
});

(async () => {
  if (!vm.SourceTextModule) throw new Error("Use node --experimental-vm-modules tools/test-wings.cjs");
  let passed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); passed++; }
    catch (error) { console.error(`FAIL ${name}\n${error.stack}`); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} wing regression tests passed.`);
})();
