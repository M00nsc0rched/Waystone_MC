import { EnchantmentSlot } from "@minecraft/server";

// Central enchantment configuration for Enchanting Waypoints.
//
// Every category lists:
//   fixed     - enchantments always attempted (id + target level)
//   exclusive - groups of mutually exclusive alternatives; exactly one
//               alternative per group is chosen. If the item already carries
//               an enchantment from one alternative, that alternative wins,
//               otherwise one is picked at random (uniform, i.e. 50-50 for two).
//
// Levels are targets: they are clamped to the enchantment's real maxLevel and
// an existing higher level is never lowered. Enchantments that do not exist in
// the running Bedrock version (e.g. "sweeping") are skipped without error.

const E = (id, level = 1) => ({ id, level });

export const ENCHANTMENT_CONFIG = {
  helmet: {
    fixed: [E("protection", 4), E("unbreaking", 3), E("thorns", 3), E("respiration", 3), E("aqua_affinity"), E("mending")],
    exclusive: []
  },
  chestplate: {
    fixed: [E("protection", 4), E("unbreaking", 3), E("thorns", 3), E("mending")],
    exclusive: []
  },
  leggings: {
    fixed: [E("protection", 4), E("unbreaking", 3), E("thorns", 3), E("swift_sneak", 3), E("mending")],
    exclusive: []
  },
  boots: {
    fixed: [E("protection", 4), E("unbreaking", 3), E("thorns", 3), E("feather_falling", 4), E("depth_strider", 3), E("soul_speed", 3), E("mending")],
    exclusive: []
  },
  sword: {
    // "sweeping" (Sweeping Edge) does not exist on Bedrock; it is listed so it
    // applies automatically should a future version add it.
    fixed: [E("looting", 3), E("fire_aspect", 2), E("knockback", 2), E("unbreaking", 3), E("mending"), E("sweeping", 3)],
    exclusive: [
      [[E("sharpness", 5)], [E("smite", 5)]]
    ]
  },
  mace: {
    // Density / Breach / Wind Burst are mace-only on Bedrock.
    fixed: [E("wind_burst", 2), E("fire_aspect", 2), E("unbreaking", 3), E("mending")],
    exclusive: [
      [[E("density", 5)], [E("breach", 4)]]
    ]
  },
  pickaxe: {
    fixed: [E("efficiency", 5), E("unbreaking", 3), E("mending")],
    exclusive: [
      [[E("fortune", 3)], [E("silk_touch")]]
    ]
  },
  axe: {
    fixed: [E("efficiency", 5), E("unbreaking", 3), E("mending")],
    exclusive: [
      [[E("fortune", 3)], [E("silk_touch")]]
    ]
  },
  shovel: {
    fixed: [E("efficiency", 5), E("unbreaking", 3), E("mending")],
    exclusive: [
      [[E("fortune", 3)], [E("silk_touch")]]
    ]
  },
  hoe: {
    fixed: [E("efficiency", 5), E("unbreaking", 3), E("mending")],
    exclusive: [
      [[E("fortune", 3)], [E("silk_touch")]]
    ]
  },
  trident: {
    fixed: [E("impaling", 5), E("unbreaking", 3), E("mending")],
    exclusive: [
      [[E("riptide", 3)], [E("loyalty", 3), E("channeling")]]
    ]
  },
  bow: {
    fixed: [E("power", 5), E("punch", 2), E("flame"), E("unbreaking", 3)],
    exclusive: [
      [[E("infinity")], [E("mending")]]
    ]
  },
  crossbow: {
    fixed: [E("quick_charge", 3), E("unbreaking", 3), E("mending")],
    exclusive: [
      [[E("piercing", 4)], [E("multishot")]]
    ]
  },
  fishing_rod: {
    fixed: [E("lure", 3), E("luck_of_the_sea", 3), E("unbreaking", 3), E("mending")],
    exclusive: []
  },
  other: {
    // Only what the item genuinely accepts is applied (checked at runtime).
    fixed: [E("unbreaking", 3), E("mending"), E("efficiency", 5), E("silk_touch")],
    exclusive: []
  }
};

// Enchantments in the same group can never coexist on one item. If an item
// already carries one member, the others are skipped instead of overwriting.
export const CONFLICTS = [
  ["sharpness", "smite", "bane_of_arthropods"],
  ["density", "breach", "smite", "bane_of_arthropods"],
  ["fortune", "silk_touch"],
  ["riptide", "loyalty"],
  ["riptide", "channeling"],
  ["infinity", "mending"],
  ["piercing", "multishot"],
  ["depth_strider", "frost_walker"],
  ["protection", "fire_protection", "blast_protection", "projectile_protection"]
];

// Item type id -> category. Order matters: more specific suffixes first
// ("pickaxe" must win over "axe", "crossbow" over "bow").
export const CATEGORY_RULES = [
  { test: (id) => id.endsWith("_pickaxe"), category: "pickaxe" },
  { test: (id) => id.endsWith("_axe"), category: "axe" },
  { test: (id) => id.endsWith("_shovel"), category: "shovel" },
  { test: (id) => id.endsWith("_hoe"), category: "hoe" },
  { test: (id) => id.endsWith("_sword"), category: "sword" },
  { test: (id) => id === "minecraft:mace", category: "mace" },
  { test: (id) => id === "minecraft:crossbow", category: "crossbow" },
  { test: (id) => id === "minecraft:bow", category: "bow" },
  { test: (id) => id === "minecraft:trident", category: "trident" },
  { test: (id) => id === "minecraft:fishing_rod", category: "fishing_rod" },
  { test: (id) => id.endsWith("_helmet"), category: "helmet" },
  { test: (id) => id.endsWith("_chestplate"), category: "chestplate" },
  { test: (id) => id.endsWith("_leggings"), category: "leggings" },
  { test: (id) => id.endsWith("_boots"), category: "boots" }
];

// Fallback when the type id is unknown (e.g. an add-on item): derive the
// category from the enchantable slots the item reports. Shield, Elytra,
// Shears, Flintsteel, CarrotStick and CosmeticHead intentionally stay
// unmapped so they fall through to "other".
export const SLOT_CATEGORIES = {
  [EnchantmentSlot.ArmorHead]: "helmet",
  [EnchantmentSlot.ArmorTorso]: "chestplate",
  [EnchantmentSlot.ArmorLegs]: "leggings",
  [EnchantmentSlot.ArmorFeet]: "boots",
  [EnchantmentSlot.Sword]: "sword",
  [EnchantmentSlot.Bow]: "bow",
  [EnchantmentSlot.Crossbow]: "crossbow",
  [EnchantmentSlot.Spear]: "trident",
  [EnchantmentSlot.FishingRod]: "fishing_rod",
  [EnchantmentSlot.Pickaxe]: "pickaxe",
  [EnchantmentSlot.Axe]: "axe",
  [EnchantmentSlot.Shovel]: "shovel",
  [EnchantmentSlot.Hoe]: "hoe"
};

export const ENCHANTMENT_NAMES = {
  protection: "Protection",
  fire_protection: "Fire Protection",
  blast_protection: "Blast Protection",
  projectile_protection: "Projectile Protection",
  unbreaking: "Unbreaking",
  thorns: "Thorns",
  respiration: "Respiration",
  aqua_affinity: "Aqua Affinity",
  mending: "Mending",
  swift_sneak: "Swift Sneak",
  feather_falling: "Feather Falling",
  depth_strider: "Depth Strider",
  frost_walker: "Frost Walker",
  soul_speed: "Soul Speed",
  sharpness: "Sharpness",
  smite: "Smite",
  bane_of_arthropods: "Bane of Arthropods",
  sweeping: "Sweeping Edge",
  looting: "Looting",
  fire_aspect: "Fire Aspect",
  knockback: "Knockback",
  density: "Density",
  breach: "Breach",
  wind_burst: "Wind Burst",
  efficiency: "Efficiency",
  fortune: "Fortune",
  silk_touch: "Silk Touch",
  riptide: "Riptide",
  loyalty: "Loyalty",
  channeling: "Channeling",
  impaling: "Impaling",
  power: "Power",
  punch: "Punch",
  flame: "Flame",
  infinity: "Infinity",
  piercing: "Piercing",
  multishot: "Multishot",
  quick_charge: "Quick Charge",
  lure: "Lure",
  luck_of_the_sea: "Luck of the Sea"
};

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function describeEnchantment(id, level) {
  const name = ENCHANTMENT_NAMES[id] ?? id;
  return level > 1 || ROMAN[level] === undefined ? `${name} ${ROMAN[level] ?? level}` : name;
}
