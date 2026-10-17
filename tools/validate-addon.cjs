const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packs = ['WaypointMonuments_BP', 'WaypointMonuments_RP'];
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? files(target) : [target];
  });
}

let jsonCount = 0;
let scriptCount = 0;
const documents = [];
for (const pack of packs) {
  for (const file of files(path.join(root, pack))) {
    if (file.endsWith('.json')) {
      documents.push({ file, data: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) });
      jsonCount++;
    }
    if (!file.endsWith('.js')) continue;
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${file}: ${checked.stderr}`);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `${file}: missing ${match[1]}`);
    }
    scriptCount++;
  }
}
const geometries = new Set();
const animations = new Set();
const controllers = new Set();
const customItems = new Set();
for (const { data } of documents) {
  for (const geometry of data['minecraft:geometry'] ?? []) geometries.add(geometry.description.identifier);
  for (const id of Object.keys(data)) if (id.startsWith('geometry.')) geometries.add(id);
  for (const id of Object.keys(data.animations ?? {})) animations.add(id);
  for (const id of Object.keys(data.render_controllers ?? {})) controllers.add(id);
  const item = data['minecraft:block'] ?? data['minecraft:item'];
  if (item) customItems.add(item.description.identifier);
}
for (const { file, data } of documents) {
  const block = data['minecraft:block'];
  if (block) {
    const components = block.components ?? {};
    const geometry = components['minecraft:geometry'];
    const id = typeof geometry === 'string' ? geometry : geometry?.identifier;
    if (id && !id.startsWith('minecraft:')) assert.ok(geometries.has(id), `${file}: missing geometry ${id}`);
    const loot = components['minecraft:loot'];
    if (loot) assert.ok(fs.existsSync(path.join(root, packs[0], loot)), `${file}: missing loot ${loot}`);
  }
  const client = data['minecraft:client_entity']?.description;
  if (client) {
    for (const id of Object.values(client.geometry ?? {})) {
      if (id.startsWith('geometry.wp')) assert.ok(geometries.has(id), `${file}: missing ${id}`);
    }
    for (const id of Object.values(client.animations ?? {})) {
      if (id.startsWith('animation.wp.')) assert.ok(animations.has(id), `${file}: missing ${id}`);
    }
    for (const id of client.render_controllers ?? []) {
      if (typeof id === 'string' && id.startsWith('controller.render.wp')) assert.ok(controllers.has(id), `${file}: missing ${id}`);
    }
    for (const texture of Object.values(client.textures ?? {})) {
      assert.ok(['.png', '.tga'].some(extension => fs.existsSync(path.join(root, packs[1], texture + extension))), `${file}: missing texture ${texture}`);
    }
  }
  const recipe = data['minecraft:recipe_shapeless'] ?? data['minecraft:recipe_shaped'];
  if (recipe?.result?.item?.startsWith('wp:')) assert.ok(customItems.has(recipe.result.item), `${file}: undefined recipe result`);
}
const bp = JSON.parse(fs.readFileSync(path.join(root, packs[0], 'manifest.json'), 'utf8'));
const rp = JSON.parse(fs.readFileSync(path.join(root, packs[1], 'manifest.json'), 'utf8'));
assert.deepEqual(bp.header.version, rp.header.version, 'BP/RP versions differ');
for (const manifest of [bp, rp]) {
  for (const module of manifest.modules) assert.deepEqual(module.version, manifest.header.version);
}
const dependency = bp.dependencies.find(entry => entry.uuid === rp.header.uuid);
assert.ok(dependency, 'BP does not reference RP');
assert.deepEqual(dependency.version, rp.header.version);
const entry = bp.modules.find(module => module.type === 'script')?.entry;
assert.ok(entry && fs.existsSync(path.join(root, packs[0], entry)), 'Missing script entry');
console.log(`Validated ${jsonCount} JSON files, ${scriptCount} JavaScript modules and asset references; pack v${bp.header.version.join('.')}.`);
