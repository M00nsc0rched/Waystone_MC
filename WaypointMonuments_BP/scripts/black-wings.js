import { world, system, EquipmentSlot, InputButton, ButtonState } from "@minecraft/server";
import { hasBlackWings } from "./wing-enchantment.js";

export const BLACK_WINGS_CONFIG = {
  horizontalSpeed: 0.42, // blocks/tick (8.4 blocks/second)
  verticalSpeed: 0.30,
  doubleJumpTicks: 7,
  entityId: "wp:black_wings"
};

const states = new Map();
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

function equipped(player) {
  return hasBlackWings(player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Chest));
}

function newState(player) {
  const state = {
    flying: false, lastJump: -1000, anchor: undefined,
    dimension: player.dimension.id, wing: undefined, lastWingState: undefined,
    retryAt: 0
  };
  states.set(player.id, state);
  player.sendMessage("§5Black Wings I§7: dupla ugrás = repülés be/ki; mozgás = irányítás; ugrás = fel; guggolás = le.");
  return state;
}

function removeState(id) {
  const state = states.get(id);
  try { state?.wing?.remove(); } catch {}
  states.delete(id);
}

function flightMode(player) {
  const mode = String(player.getGameMode()).toLowerCase();
  if (mode === "spectator") return "hidden";
  if (mode === "creative") return "native";
  return "script";
}

// Waypoints can be closer than the movement-based external-teleport heuristic.
// Explicitly release our anchor before this add-on teleports a player.
export function stopBlackWingsFlight(player) {
  const state = states.get(player.id);
  if (!state) return;
  state.flying = false;
  state.anchor = undefined;
  state.lastJump = -1000;
}

export function initBlackWings() {
  world.afterEvents.playerButtonInput.subscribe((ev) => {
    if (ev.button !== InputButton.Jump || ev.newButtonState !== ButtonState.Pressed) return;
    try {
      const player = ev.player;
      if (!equipped(player) || flightMode(player) !== "script") return;
      const state = states.get(player.id) ?? newState(player);
      if (!canFly(player)) return;
      const now = system.currentTick;
      if (now - state.lastJump > BLACK_WINGS_CONFIG.doubleJumpTicks) {
        state.lastJump = now;
        return;
      }
      state.lastJump = -1000;
      state.flying = !state.flying;
      state.anchor = state.flying ? { ...player.location } : undefined;
      state.dimension = player.dimension.id;
      player.onScreenDisplay.setActionBar(state.flying ? "§5Fekete szárnyak: repülés" : "§7Fekete szárnyak: repülés kikapcsolva");
    } catch (error) {
      console.warn(`[Waypoint wings] input: ${error}`);
    }
  });

  world.afterEvents.playerLeave.subscribe((ev) => removeState(ev.playerId));
  world.afterEvents.entityDie.subscribe((ev) => {
    if (ev.deadEntity.typeId === "minecraft:player") removeState(ev.deadEntity.id);
  });
  // A respawn must never inherit an aerial anchor from before death.
  world.afterEvents.playerSpawn.subscribe((ev) => removeState(ev.player.id));

  system.runInterval(tickWings, 1);
  system.run(cleanOrphanWings);
  system.runInterval(cleanOrphanWings, 100);
}

function canFly(player) {
  if (player.getComponent("minecraft:health")?.currentValue <= 0) return false;
  if (player.isInWater || player.isSwimming || player.isSleeping) return false;
  return !player.getComponent("minecraft:riding")?.entityRidingOn;
}

function tickWings() {
  const present = new Set();
  for (const player of world.getAllPlayers()) {
    present.add(player.id);
    try {
      if (!equipped(player) || flightMode(player) === "hidden" ||
          player.getComponent("minecraft:health")?.currentValue <= 0) {
        removeState(player.id);
        continue;
      }
      const state = states.get(player.id) ?? newState(player);
      if (state.dimension !== player.dimension.id || !canFly(player) || flightMode(player) !== "script") {
        state.flying = false;
        state.anchor = undefined;
        state.lastJump = -1000;
        state.dimension = player.dimension.id;
      }
      // Other teleport systems (including waypoints / Deep Sky) take priority.
      if (state.flying && state.anchor && distanceSquared(player.location, state.anchor) > 9) {
        state.flying = false;
        state.anchor = undefined;
      }
      if (state.flying) moveInFlight(player, state);
      followPlayer(player, state, state.flying || player.isFlying || player.isGliding);
    } catch (error) {
      removeState(player.id);
      console.warn(`[Waypoint wings] update: ${error}`);
    }
  }
  for (const id of states.keys()) if (!present.has(id)) removeState(id);
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

export function flightStep(movement, yaw, jumping, sneaking) {
  const angle = yaw * Math.PI / 180;
  const scale = BLACK_WINGS_CONFIG.horizontalSpeed / Math.max(1, Math.hypot(movement.x, movement.y));
  // InputInfo uses positive X for left and positive Y for forward.
  return {
    x: (movement.x * Math.cos(angle) - movement.y * Math.sin(angle)) * scale,
    y: ((jumping ? 1 : 0) - (sneaking ? 1 : 0)) * BLACK_WINGS_CONFIG.verticalSpeed,
    z: (movement.x * Math.sin(angle) + movement.y * Math.cos(angle)) * scale
  };
}

function moveInFlight(player, state) {
  const delta = flightStep(
    player.inputInfo.getMovementVector(), player.getRotation().y,
    player.inputInfo.getButtonState(InputButton.Jump) === ButtonState.Pressed,
    player.isSneaking
  );
  // Stable server 2.0.0 explicitly rejects Player.applyImpulse/clearVelocity.
  // Small checked teleports implement creative-style hover and movement with
  // the real chestplate still equipped. No ability command, game mode change,
  // fireworks or Slow Falling effect (which would extend a Deep Sky visit).
  const options = { checkForBlocks: true, keepVelocity: false };
  let anchor = { ...state.anchor };
  // Substeps prevent crossing a thin obstacle; slide along blocked surfaces.
  for (let step = 0; step < 2; step++) {
    for (const axis of ["y", "x", "z"]) {
      if (Math.abs(delta[axis]) < 0.0001) continue;
      const target = { ...anchor, [axis]: anchor[axis] + delta[axis] / 2 };
      if (player.tryTeleport(target, options)) anchor = target;
    }
  }
  // Also reset gravity when hovering or when all attempted movement is blocked.
  player.tryTeleport(anchor, options);
  state.anchor = anchor;
}

function followPlayer(player, state, flying) {
  try {
    if (!state.wing?.isValid) {
      if (system.currentTick < state.retryAt) return;
      state.wing = player.dimension.spawnEntity(BLACK_WINGS_CONFIG.entityId, player.location);
      state.lastWingState = undefined;
    }
    state.wing.teleport(player.location, {
      dimension: player.dimension, rotation: { x: 0, y: player.getRotation().y }, keepVelocity: false
    });
    if (state.lastWingState !== flying) {
      state.wing.setProperty("wp:flying", !!flying);
      state.lastWingState = flying;
    }
  } catch (error) {
    try { state.wing?.remove(); } catch {}
    state.wing = undefined;
    state.retryAt = system.currentTick + 100;
    console.warn(`[Waypoint wings] visual: ${error}`);
  }
}

function cleanOrphanWings() {
  const owned = new Set([...states.values()].map((state) => state.wing?.id).filter(Boolean));
  for (const id of DIMENSIONS) {
    try {
      for (const entity of world.getDimension(id).getEntities({ type: BLACK_WINGS_CONFIG.entityId })) {
        if (!owned.has(entity.id)) entity.remove();
      }
    } catch {}
  }
}
