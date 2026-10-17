// Pure, deterministic geometry. Coordinates run left-to-right (x), upward (y),
// and away from the entrance (z); no commands or world access are used here.
export const BUILDING_SPECS = Object.freeze({
  castle: Object.freeze({ name: "Vár", width: 27, depth: 31, height: 25 }),
  cathedral: Object.freeze({ name: "Katedrális", width: 23, depth: 35, height: 32 })
});

const AIR = "minecraft:air";
const STONE = "minecraft:stone_bricks";
const TRIM = "minecraft:polished_andesite";
const WOOD = "minecraft:dark_oak_planks";
const QUARTZ = "minecraft:quartz_block";
const GOLD = "minecraft:gold_block";
const BLUE = "minecraft:blue_stained_glass";
const RED = "minecraft:red_stained_glass";

function blueprint(spec) {
  const blocks = new Map();
  function put(x, y, z, type) {
    if (x < 0 || x >= spec.width || y < 0 || y >= spec.height || z < 0 || z >= spec.depth) {
      throw new Error(`Blueprint coordinate outside ${spec.name}: ${x},${y},${z}`);
    }
    const key = `${x},${y},${z}`;
    if (type === AIR) blocks.delete(key);
    else blocks.set(key, { x, y, z, type });
  }
  function box(x1, y1, z1, x2, y2, z2, type) {
    for (let y = y1; y <= y2; y++) {
      for (let z = z1; z <= z2; z++) {
        for (let x = x1; x <= x2; x++) put(x, y, z, type);
      }
    }
  }
  function walls(x1, y1, z1, x2, y2, z2, type) {
    box(x1, y1, z1, x2, y2, z1, type);
    box(x1, y1, z2, x2, y2, z2, type);
    box(x1, y1, z1, x1, y2, z2, type);
    box(x2, y1, z1, x2, y2, z2, type);
  }
  return { blocks, put, box, walls };
}

function castle(b) {
  const { put, box, walls } = b;
  box(0, 0, 0, 26, 0, 30, "minecraft:smooth_stone");
  box(8, 0, 7, 18, 0, 15, "minecraft:grass_block");
  box(12, 0, 0, 14, 0, 17, TRIM);
  walls(1, 1, 1, 25, 7, 29, STONE);
  walls(1, 7, 1, 25, 7, 29, TRIM);
  // Crenellated curtain walls and the elevated walkway behind them.
  box(2, 6, 2, 24, 6, 3, STONE);
  box(2, 6, 27, 24, 6, 28, STONE);
  box(2, 6, 2, 3, 6, 28, STONE);
  box(23, 6, 2, 24, 6, 28, STONE);
  for (let x = 1; x <= 25; x += 2) {
    put(x, 8, 1, STONE);
    put(x, 8, 29, STONE);
  }
  for (let z = 1; z <= 29; z += 2) {
    put(1, 8, z, STONE);
    put(25, 8, z, STONE);
  }
  // Four square corner towers with windows, interior floors and battlements.
  for (const [cx, cz] of [[4, 4], [22, 4], [4, 26], [22, 26]]) {
    walls(cx - 3, 1, cz - 3, cx + 3, 12, cz + 3, STONE);
    box(cx - 2, 6, cz - 2, cx + 2, 6, cz + 2, WOOD);
    box(cx - 2, 11, cz - 2, cx + 2, 11, cz + 2, WOOD);
    walls(cx - 3, 12, cz - 3, cx + 3, 12, cz + 3, TRIM);
    for (let n = -3; n <= 3; n += 2) {
      put(cx + n, 13, cz - 3, STONE);
      put(cx + n, 13, cz + 3, STONE);
      put(cx - 3, 13, cz + n, STONE);
      put(cx + 3, 13, cz + n, STONE);
    }
    for (const y of [3, 8]) {
      box(cx, y, cz - 3, cx, y + 1, cz - 3, BLUE);
      box(cx, y, cz + 3, cx, y + 1, cz + 3, BLUE);
      box(cx - 3, y, cz, cx - 3, y + 1, cz, BLUE);
      box(cx + 3, y, cz, cx + 3, y + 1, cz, BLUE);
    }
    const inward = cx < 13 ? cx + 3 : cx - 3;
    box(inward, 1, cz - 1, inward, 3, cz + 1, AIR);
    box(cx - 1, 1, cz + (cz < 15 ? 3 : -3), cx + 1, 3, cz + (cz < 15 ? 3 : -3), AIR);
    put(cx, 11, cz, "minecraft:glowstone");
  }
  // Gatehouse: a five-block opening with a stepped stone arch.
  box(10, 1, 1, 16, 9, 3, STONE);
  box(11, 1, 1, 15, 4, 3, AIR);
  box(12, 5, 1, 14, 5, 3, AIR);
  box(10, 7, 0, 10, 9, 0, GOLD);
  box(16, 7, 0, 16, 9, 0, GOLD);
  // A furnished, two-level keep with a steep dark roof.
  walls(8, 1, 17, 18, 14, 27, STONE);
  box(8, 7, 17, 18, 7, 27, WOOD);
  walls(8, 7, 17, 18, 7, 27, TRIM);
  for (let i = 0; i <= 5; i++) {
    box(7 + i, 15 + i, 16, 19 - i, 15 + i, 28, WOOD);
  }
  for (let i = 0; i <= 4; i++) {
    box(9 + i, 15 + i, 17, 17 - i, 15 + i, 17, STONE);
    box(9 + i, 15 + i, 27, 17 - i, 15 + i, 27, STONE);
  }
  box(11, 1, 17, 15, 3, 17, AIR);
  box(12, 4, 17, 14, 4, 17, AIR);
  for (const y of [3, 10]) {
    for (const z of [20, 24]) {
      box(8, y, z, 8, y + 2, z + 1, BLUE);
      box(18, y, z, 18, y + 2, z + 1, BLUE);
    }
    box(12, y, 27, 14, y + 2, 27, BLUE);
  }
  box(12, 10, 17, 14, 12, 17, BLUE);
  // Staircase to the keep's upper floor; its final two steps cut the floor.
  for (let i = 0; i < 7; i++) {
    box(9, 1, 19 + i, 10, i + 1, 19 + i, WOOD);
    if (i >= 4) box(9, i + 2, 19 + i, 10, 9, 19 + i, AIR);
  }
  box(12, 1, 24, 14, 1, 25, WOOD);
  put(13, 2, 25, GOLD);
  for (const z of [20, 25]) {
    put(11, 6, z, "minecraft:glowstone");
    put(15, 13, z, "minecraft:glowstone");
  }
  box(13, 21, 23, 13, 24, 23, "minecraft:dark_oak_fence");
  box(14, 23, 23, 16, 24, 23, "minecraft:red_wool");
  // Lit courtyard details, with an uninterrupted central approach.
  for (const x of [9, 17]) {
    for (const z of [8, 14]) {
      put(x, 1, z, STONE);
      put(x, 2, z, "minecraft:glowstone");
    }
  }
}

function cathedral(b) {
  const { put, box, walls } = b;
  box(0, 0, 0, 22, 0, 34, "minecraft:smooth_stone");
  box(10, 0, 0, 12, 0, 30, "minecraft:polished_deepslate");
  box(11, 0, 1, 11, 0, 29, GOLD);
  walls(5, 1, 6, 17, 13, 31, QUARTZ);
  walls(2, 1, 9, 20, 7, 30, QUARTZ);
  // Open side aisles connect to the taller central nave.
  box(3, 1, 10, 19, 7, 29, AIR);
  box(6, 1, 9, 16, 7, 9, AIR);
  box(6, 1, 30, 16, 7, 30, AIR);
  for (const x of [5, 17]) {
    for (let z = 10; z <= 29; z++) {
      if ((z - 10) % 6 <= 1) box(x, 1, z, x, 12, z, QUARTZ);
    }
    box(x, 8, 9, x, 13, 30, QUARTZ);
  }
  // Side aisle roofs step upward to the clerestory.
  for (let i = 0; i < 4; i++) {
    box(1 + i, 8 + i, 9, 1 + i, 8 + i, 31, "minecraft:deepslate_tiles");
    box(21 - i, 8 + i, 9, 21 - i, 8 + i, 31, "minecraft:deepslate_tiles");
  }
  for (let x = 4; x <= 18; x++) {
    const y = 14 + Math.min(x - 4, 18 - x);
    box(x, y, 5, x, y, 32, "minecraft:deepslate_tiles");
    if (x >= 5 && x <= 17) {
      box(x, 14, 6, x, y - 1, 6, QUARTZ);
      box(x, 14, 31, x, y - 1, 31, QUARTZ);
    }
  }
  // Flying buttresses, colored lancet windows and stone ribs.
  for (const z of [11, 17, 23, 29]) {
    for (const x of [1, 21]) box(x, 1, z, x, 9, z, QUARTZ);
    for (let i = 0; i < 4; i++) {
      put(1 + i, 10 + i, z, QUARTZ);
      put(21 - i, 10 + i, z, QUARTZ);
    }
    for (const x of [2, 20]) {
      box(x, 2, z + 1, x, 5, z + 2, z % 4 === 1 ? RED : BLUE);
      put(x, 6, z + 1, BLUE);
    }
    for (const x of [5, 17]) {
      box(x, 9, z + 1, x, 11, z + 2, BLUE);
      put(x, 12, z + 1, RED);
    }
    for (let i = 0; i <= 5; i++) {
      put(6 + i, 12 + i, z, QUARTZ);
      put(16 - i, 12 + i, z, QUARTZ);
    }
  }
  // Twin bell towers with open belfries, steep roofs and gold crosses.
  for (const cx of [4, 18]) {
    walls(cx - 3, 1, 2, cx + 3, 21, 8, QUARTZ);
    for (const y of [7, 14, 21]) {
      walls(cx - 3, y, 2, cx + 3, y, 8, "minecraft:polished_diorite");
    }
    for (const y of [3, 10]) {
      box(cx, y, 2, cx, y + 3, 2, BLUE);
      box(cx - 3, y, 5, cx - 3, y + 3, 5, RED);
      box(cx + 3, y, 5, cx + 3, y + 3, 5, RED);
    }
    box(cx - 1, 16, 2, cx + 1, 19, 2, AIR);
    box(cx - 1, 16, 8, cx + 1, 19, 8, AIR);
    box(cx - 3, 16, 4, cx - 3, 19, 6, AIR);
    box(cx + 3, 16, 4, cx + 3, 19, 6, AIR);
    put(cx, 18, 5, GOLD);
    put(cx, 20, 5, "minecraft:glowstone");
    for (let i = 0; i <= 3; i++) {
      box(cx - 3 + i, 22 + i, 2 + i, cx + 3 - i, 22 + i, 8 - i, "minecraft:deepslate_tiles");
    }
    box(cx, 26, 5, cx, 30, 5, GOLD);
    box(cx - 1, 29, 5, cx + 1, 29, 5, GOLD);
  }
  // Front rose window, entrance arch and a small rear sanctuary.
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      const r = dx * dx + dy * dy;
      if (r <= 10) put(11 + dx, 11 + dy, 6, r >= 7 ? GOLD : (dx === 0 || dy === 0 ? RED : BLUE));
    }
  }
  box(9, 1, 6, 13, 5, 6, AIR);
  box(10, 6, 6, 12, 6, 6, AIR);
  put(11, 7, 6, AIR);
  walls(8, 1, 31, 14, 8, 33, QUARTZ);
  box(9, 1, 31, 13, 5, 31, AIR);
  box(8, 9, 31, 14, 9, 33, "minecraft:deepslate_tiles");
  box(10, 3, 33, 12, 6, 33, BLUE);
  box(9, 1, 28, 13, 1, 29, QUARTZ);
  box(10, 2, 29, 12, 2, 29, GOLD);
  box(11, 3, 30, 11, 6, 30, GOLD);
  box(10, 5, 30, 12, 5, 30, GOLD);
  // Pews preserve a three-block central aisle.
  for (const z of [12, 16, 20, 24]) {
    box(6, 1, z, 9, 1, z, WOOD);
    box(13, 1, z, 16, 1, z, WOOD);
    box(6, 2, z + 1, 9, 2, z + 1, "minecraft:dark_oak_fence");
    box(13, 2, z + 1, 16, 2, z + 1, "minecraft:dark_oak_fence");
  }
  for (const z of [10, 18, 26]) {
    put(11, 17, z, "minecraft:sea_lantern");
    for (const x of [3, 19]) put(x, 6, z, "minecraft:glowstone");
  }
}

export function makeBuildingPlan(kind) {
  const spec = BUILDING_SPECS[kind];
  if (!spec) throw new Error(`Unknown building: ${kind}`);
  const b = blueprint(spec);
  if (kind === "castle") castle(b);
  else cathedral(b);
  return {
    ...spec,
    blocks: b.blocks,
    materials: [...new Set([...b.blocks.values()].map((entry) => entry.type))]
  };
}

export function headingFromView(view) {
  if (Math.abs(view.x) > Math.abs(view.z)) return view.x >= 0 ? "east" : "west";
  return view.z >= 0 ? "south" : "north";
}

const FORWARD = Object.freeze({
  north: Object.freeze({ x: 0, z: -1 }),
  east: Object.freeze({ x: 1, z: 0 }),
  south: Object.freeze({ x: 0, z: 1 }),
  west: Object.freeze({ x: -1, z: 0 })
});

export function buildingLocation(anchor, heading, width, x, y, z) {
  const f = FORWARD[heading] ?? FORWARD.north;
  const sideways = x - Math.floor(width / 2);
  // Three blocks between the planner and the front platform keep the owner
  // outside the footprint; the doorway faces back toward the planner.
  return {
    x: anchor.x - f.z * sideways + f.x * (z + 3),
    y: anchor.y + y,
    z: anchor.z + f.x * sideways + f.z * (z + 3)
  };
}
