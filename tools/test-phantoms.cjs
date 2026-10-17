// Run: node --experimental-vm-modules tools/test-phantoms.cjs
// These tests dispatch the mocked melee event. Confirm that a zero-damage
// phantom bite emits that event in a Minecraft world during the smoke test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

async function loadModule(name, world, system) {
  const filename = path.join(root, "WaypointMonuments_BP", "scripts", `${name}.js`);
  const context = vm.createContext({ console });
  const api = {
    world,
    system,
    EntityDamageCause: { override: "override" },
    ItemStack: class ItemStack {}
  };
  const minecraft = new vm.SyntheticModule(Object.keys(api), function () {
    for (const [key, value] of Object.entries(api)) this.setExport(key, value);
  }, { context });
  const module = new vm.SourceTextModule(fs.readFileSync(filename, "utf8"), {
    context,
    identifier: filename
  });
  await module.link((specifier) => {
    assert.equal(specifier, "@minecraft/server");
    return minecraft;
  });
  await module.evaluate();
  return module.namespace;
}

function eventRegistry() {
  const callbacks = new Map();
  return {
    signal(name) {
      return { subscribe(callback) { callbacks.set(name, callback); } };
    },
    emit(name, event) {
      assert.ok(callbacks.has(name), `Expected subscription: ${name}`);
      callbacks.get(name)(event);
    }
  };
}

function makeHealth(currentValue, effectiveMax = 20) {
  return {
    currentValue,
    effectiveMax,
    setCurrentValue(value) {
      assert.ok(value >= 0 && value <= this.effectiveMax);
      this.currentValue = value;
      return true;
    }
  };
}

async function testBitesAndBonusDamage() {
  const events = eventRegistry();
  const world = {
    afterEvents: {
      entityHitEntity: events.signal("hit"),
      entityHurt: events.signal("hurt")
    },
    beforeEvents: { explosion: events.signal("explosion") }
  };
  const gameplay = await loadModule("gameplay", world, { runInterval() {} });
  gameplay.initGameplay();

  const phantomHealth = makeHealth(18);
  const phantom = {
    id: "phantom1",
    typeId: "minecraft:phantom",
    getComponent(id) {
      return id === "minecraft:health"
        ? phantomHealth
        : { hasTypeFamily: () => true };
    }
  };
  const effects = [];
  const playerHealth = makeHealth(10);
  const player = {
    id: "player1",
    typeId: "minecraft:player",
    addEffect(...args) {
      // Normalize objects created in the module's VM context for comparison.
      effects.push(JSON.parse(JSON.stringify(args)));
    },
    getComponent() { return playerHealth; }
  };

  events.emit("hit", { damagingEntity: phantom, hitEntity: player });
  assert.deepEqual(effects, ["weakness", "slowness", "nausea"].map((id) => [
    id, 100, { amplifier: 0, showParticles: true }
  ]));
  assert.equal(phantomHealth.currentValue, 19, "The attacking phantom heals one HP");
  assert.equal(playerHealth.currentValue, 10, "The bite handler does not damage the player");

  phantomHealth.currentValue = 20;
  events.emit("hit", { damagingEntity: phantom, hitEntity: player });
  assert.equal(phantomHealth.currentValue, 20, "Healing never exceeds maximum health");
  phantomHealth.currentValue = 0;
  events.emit("hit", { damagingEntity: phantom, hitEntity: player });
  assert.equal(phantomHealth.currentValue, 0, "A dead phantom is not resurrected");

  const effectCount = effects.length;
  events.emit("hit", { damagingEntity: phantom, hitEntity: { typeId: "minecraft:cow" } });
  const zombie = { ...phantom, id: "zombie1", typeId: "minecraft:zombie" };
  events.emit("hit", { damagingEntity: zombie, hitEntity: player });
  assert.equal(effects.length, effectCount, "Only phantom bites against players apply effects");

  const hurt = (damagingEntity, damagingProjectile) => events.emit("hurt", {
    damage: 1,
    hurtEntity: player,
    damageSource: { cause: "entityAttack", damagingEntity, damagingProjectile }
  });
  hurt(phantom);
  assert.equal(playerHealth.currentValue, 10, "Phantoms do not receive the hostile damage bonus");
  hurt(undefined, { getComponent: () => ({ owner: phantom }) });
  assert.equal(playerHealth.currentValue, 10, "A phantom projectile owner also receives no bonus");
  hurt(zombie);
  assert.equal(playerHealth.currentValue, 6, "Other hostile mobs retain their four-HP damage bonus");
}

function testVanillaDefinition() {
  const baseline = JSON.parse(fs.readFileSync(path.join(root, "tools_vanilla", "phantom.json"), "utf8"));
  const custom = JSON.parse(fs.readFileSync(path.join(root, "WaypointMonuments_BP", "entities", "phantom.json"), "utf8"));
  assert.equal(custom["minecraft:entity"].components["minecraft:attack"].damage, 0);
  baseline["minecraft:entity"].components["minecraft:attack"].damage = 0;
  assert.deepEqual(custom, baseline, "The attack damage is the sole change to vanilla phantom behavior");
}

async function testDeepSkyCleanup() {
  const events = eventRegistry();
  const periodic = [];
  const deferred = [];
  const makeEntity = (x, y, z, dimension = "minecraft:the_end", typeId = "minecraft:phantom") => ({
    typeId,
    dimension: { id: dimension },
    location: { x, y, z },
    remove() { this.removed = true; }
  });
  const center = makeEntity(100000, 190, 100000);
  const low = makeEntity(100001, -30, 100001);
  const high = makeEntity(100001, 300, 100001);
  const outside = makeEntity(100161, 190, 100000);
  let loaded = [center, low, high, outside];
  const world = {
    getAllPlayers: () => [],
    getDimension(id) {
      assert.equal(id, "minecraft:the_end");
      return {
        getEntities(query) {
          assert.equal(query.type, "minecraft:phantom");
          return loaded;
        }
      };
    },
    beforeEvents: { playerInteractWithBlock: events.signal("interact") },
    afterEvents: {
      entitySpawn: events.signal("spawn"),
      entityDie: events.signal("die"),
      playerSpawn: events.signal("playerSpawn")
    }
  };
  const deepSky = await loadModule("deepsky", world, {
    run: (callback) => deferred.push(callback),
    runInterval: (callback, ticks) => periodic.push({ callback, ticks })
  });
  deepSky.initDeepSky();
  deferred.forEach((callback) => callback());
  for (const entity of [center, low, high]) assert.equal(entity.removed, true);
  assert.equal(outside.removed, undefined, "Phantoms outside the zone remain");

  const late = makeEntity(99900, 300, 100010);
  loaded = [late];
  const sweep = periodic.find(({ ticks }) => ticks === 20);
  assert.ok(sweep, "An ongoing sweep handles entities loaded later");
  sweep.callback();
  assert.equal(late.removed, true, "The sweep runs even without visitors");

  const boundary = makeEntity(100160, -50, 99840);
  events.emit("spawn", { entity: boundary });
  assert.equal(boundary.removed, true, "Spawn removal includes zone edges at every height");
  const overworld = makeEntity(100000, 190, 100000, "minecraft:overworld");
  events.emit("spawn", { entity: overworld });
  assert.equal(overworld.removed, undefined, "Other dimensions remain unaffected");
  const spawnedOutside = makeEntity(100000, 190, 100161);
  events.emit("spawn", { entity: spawnedOutside });
  assert.equal(spawnedOutside.removed, undefined);
  const enderman = makeEntity(100000, 190, 100000, "minecraft:the_end", "minecraft:enderman");
  events.emit("spawn", { entity: enderman });
  assert.equal(enderman.removed, true, "The existing enderman exclusion is preserved");

  const source = fs.readFileSync(path.join(root, "WaypointMonuments_BP", "scripts", "deepsky.js"), "utf8");
  assert.equal(source.includes('spawnEntity("minecraft:phantom"'), false, "No scripted phantom spawn remains");
}

(async () => {
  await testBitesAndBonusDamage();
  testVanillaDefinition();
  await testDeepSkyCleanup();
  console.log("PASS: phantom bite effects/healing, damage bonus exclusions, vanilla definition, and Deep Sky spawn/loaded-entity cleanup.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
