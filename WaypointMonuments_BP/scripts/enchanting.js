import { EnchantmentTypes, EquipmentSlot } from "@minecraft/server";
import { addBlackWings } from "./wing-enchantment.js";
import {
  ENCHANTMENT_CONFIG,
  CONFLICTS,
  CATEGORY_RULES,
  SLOT_CATEGORIES,
  describeEnchantment
} from "./config/enchantments.js";

// Result of one enchanting attempt. `status` is one of:
//   "no_item"            - empty hand
//   "not_enchantable"    - held item has no enchantable component
//   "maxed"              - every applicable enchantment is already at target level
//   "nothing_applicable" - the item accepts none of the configured enchantments
//   "error"              - an API call failed; the item is left untouched
//   "enchanted"          - at least one enchantment added or upgraded
export function enchantHeldItem(player) {
  const equippable = player.getComponent("minecraft:equippable");
  const item = equippable?.getEquipment(EquipmentSlot.Mainhand);
  if (!item) return { status: "no_item" };

  const enchantable = item.getComponent("minecraft:enchantable");
  if (!enchantable) return { status: "not_enchantable", itemId: item.typeId };

  const category = resolveCategory(item, enchantable);
  const targets = buildTargetList(category, enchantable);

  const applied = [];
  const upgraded = [];
  const skipped = [];
  const failed = [];

  for (const target of targets) {
    const outcome = applyOne(enchantable, target);
    if (outcome.kind === "added") applied.push(outcome);
    else if (outcome.kind === "upgraded") upgraded.push(outcome);
    else if (outcome.kind === "failed") failed.push(outcome);
    else skipped.push(outcome);
  }

  // A failed upgrade whose restore also failed would have stripped an
  // enchantment from the copy: never write such a copy back.
  if (failed.some((f) => f.lost)) {
    return { status: "error", itemId: item.typeId, category, failed, applied, upgraded, skipped };
  }

  if (category === "chestplate") {
    try {
      const wings = addBlackWings(item);
      if (wings) applied.push(wings);
    } catch (error) {
      // Work on an ItemStack copy; do not commit a partially changed stack.
      failed.push({ id: "wp:black_wings", label: "Black Wings I", error: String(error) });
      return { status: "error", itemId: item.typeId, category, failed, applied, upgraded, skipped };
    }
  }

  if (applied.length === 0 && upgraded.length === 0) {
    if (failed.length > 0) {
      return { status: "error", itemId: item.typeId, category, failed, applied, upgraded, skipped };
    }
    const status = skipped.some((s) => s.kind === "already_max" || s.kind === "conflict")
      ? "maxed"
      : "nothing_applicable";
    return { status, itemId: item.typeId, category, skipped };
  }

  try {
    if (!equippable.setEquipment(EquipmentSlot.Mainhand, item)) {
      throw new Error("The held item could not be updated.");
    }
  } catch (error) {
    failed.push({ id: "equipment_commit", label: "Held item", error: String(error) });
    return { status: "error", itemId: item.typeId, category, failed, applied, upgraded, skipped };
  }
  return { status: "enchanted", itemId: item.typeId, category, applied, upgraded, skipped, failed };
}

export function resolveCategory(item, enchantable) {
  const id = item.typeId;
  for (const rule of CATEGORY_RULES) {
    if (rule.test(id)) return rule.category;
  }
  try {
    for (const slot of enchantable.slots ?? []) {
      const mapped = SLOT_CATEGORIES[String(slot)];
      if (mapped) return mapped;
    }
  } catch {}
  return "other";
}

// Flattens a category's config into a concrete list of {id, level} targets,
// resolving each exclusive group to a single alternative.
export function buildTargetList(category, enchantable) {
  const config = ENCHANTMENT_CONFIG[category] ?? ENCHANTMENT_CONFIG.other;
  const targets = [...config.fixed];
  for (const group of config.exclusive) {
    targets.push(...chooseAlternative(group, enchantable));
  }
  return targets;
}

function chooseAlternative(alternatives, enchantable) {
  // An alternative the item already carries (any member of it) is kept.
  for (const alt of alternatives) {
    if (alt.some((e) => hasEnchantment(enchantable, e.id))) return alt;
  }
  // Otherwise a uniform random pick (50-50 for two alternatives).
  const idx = Math.floor(Math.random() * alternatives.length);
  return alternatives[Math.min(idx, alternatives.length - 1)];
}

function applyOne(enchantable, target) {
  const type = safeGetType(target.id);
  if (!type) {
    return { kind: "unsupported", id: target.id, level: target.level };
  }
  const level = Math.max(1, Math.min(target.level, type.maxLevel ?? target.level));
  const label = describeEnchantment(target.id, level);

  let existing;
  try {
    existing = enchantable.getEnchantment(type);
  } catch {
    existing = undefined;
  }

  if (existing) {
    if (existing.level >= level) {
      return { kind: "already_max", id: target.id, level: existing.level, label };
    }
    // Upgrade: remove the lower level, then add the higher one. If the add
    // fails the original level is restored so nothing is ever lost.
    try {
      enchantable.removeEnchantment(type);
      enchantable.addEnchantment({ type, level });
      return {
        kind: "upgraded",
        id: target.id,
        from: existing.level,
        level,
        label: `${describeEnchantment(target.id, existing.level)} → ${label}`
      };
    } catch (err) {
      let lost = false;
      try {
        if (!enchantable.hasEnchantment(type)) {
          enchantable.addEnchantment({ type, level: existing.level });
        }
        lost = !enchantable.hasEnchantment(type);
      } catch {
        lost = true;
      }
      return { kind: "failed", id: target.id, level, label, error: String(err), lost };
    }
  }

  const conflict = findConflict(enchantable, target.id);
  if (conflict) {
    return { kind: "conflict", id: target.id, level, label, with: conflict };
  }

  try {
    if (!enchantable.canAddEnchantment({ type, level })) {
      return { kind: "not_applicable", id: target.id, level, label };
    }
    enchantable.addEnchantment({ type, level });
    return { kind: "added", id: target.id, level, label };
  } catch (err) {
    return { kind: "failed", id: target.id, level, label, error: String(err) };
  }
}

// Returns the id of an enchantment already on the item that conflicts with
// `id`, or undefined when there is no conflict.
function findConflict(enchantable, id) {
  for (const group of CONFLICTS) {
    if (!group.includes(id)) continue;
    for (const other of group) {
      if (other !== id && hasEnchantment(enchantable, other)) return other;
    }
  }
  return undefined;
}

function hasEnchantment(enchantable, id) {
  const type = safeGetType(id);
  if (!type) return false;
  try {
    return enchantable.hasEnchantment(type);
  } catch {
    return false;
  }
}

const typeCache = new Map();

// EnchantmentTypes.get returns undefined for ids this Bedrock version does not
// know (e.g. "sweeping"), which is how unsupported enchantments are skipped.
// Both the bare and the "minecraft:"-prefixed spelling are tried, since
// vanilla-data switched to namespaced ids after 1.21.0.
function safeGetType(id) {
  if (typeCache.has(id)) return typeCache.get(id);
  let type;
  try {
    type = EnchantmentTypes.get(id);
    if (!type && !id.includes(":")) type = EnchantmentTypes.get(`minecraft:${id}`);
  } catch {
    type = undefined;
  }
  typeCache.set(id, type);
  return type;
}
