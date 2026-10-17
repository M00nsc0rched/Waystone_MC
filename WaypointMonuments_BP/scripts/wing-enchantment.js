// Stable Bedrock does not register new native enchantment types. Keep this
// add-on enchantment on the original stack so armor, trims, dyes, durability,
// names and all native enchantments survive unchanged.
export const BLACK_WINGS_PROPERTY = "wp:black_wings";
export const BLACK_WINGS_LABEL = "Black Wings I";

export function hasBlackWings(item) {
  return !!item && item.typeId.endsWith("_chestplate") &&
    item.getDynamicProperty(BLACK_WINGS_PROPERTY) === 1;
}

export function addBlackWings(item) {
  if (!item.typeId.endsWith("_chestplate")) return undefined;
  if (hasBlackWings(item)) return undefined;
  const lore = item.getLore();
  // Item lore is limited to 20 lines. Never discard somebody's custom lore.
  if (lore.length >= 20) throw new Error("Black Wings needs one free item lore line (maximum 20).");
  item.setLore([...lore, `§r§5${BLACK_WINGS_LABEL}`]);
  item.setDynamicProperty(BLACK_WINGS_PROPERTY, 1);
  return { kind: "added", id: "wp:black_wings", level: 1, label: BLACK_WINGS_LABEL };
}
