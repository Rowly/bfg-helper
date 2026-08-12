import { getShipData, getBaseActor } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getTurnState, PHASES } from "./turn-manager.js";
import { getCombatState } from "./combat-state.js";
import { drawWeaponArc } from "./weapon-arcs.js";

function pixelsPerCm() {
  const size = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  if (!(size > 0) || !(distance > 0)) {
    throw new Error("The current Scene does not have a valid grid size and distance.");
  }
  return size / distance;
}

function normaliseDegrees(value) {
  let result = Number(value) % 360;
  if (result < 0) result += 360;
  return result;
}

function signedAngleDifference(first, second) {
  let difference = normaliseDegrees(first) - normaliseDegrees(second);
  if (difference > 180) difference -= 360;
  if (difference <= -180) difference += 360;
  return difference;
}

function headingToPoint(from, to) {
  const dx = Number(to.x) - Number(from.x);
  const dy = Number(to.y) - Number(from.y);
  return normaliseDegrees(Math.atan2(dx, -dy) * 180 / Math.PI);
}

function weaponTypeLabel(weapon) {
  const type = String(weapon.type ?? "").toLowerCase();
  if (type === "lance") return "Lance";
  if (type === "battery") return "Weapons battery";
  return "Direct-fire weapon";
}

export function getSelectedShootingTarget() {
  const targets = [...(game.user?.targets ?? [])];
  return targets.length === 1 ? targets[0] : null;
}

export function getShootingContext(token = canvas.tokens.controlled[0]) {
  if (!token) return { ok: false, error: "Please select exactly one configured firing ship." };

  const actor = getBaseActor(token);
  const shipData = getShipData(actor);
  if (!shipData?.weapons?.length) {
    return { ok: false, error: `${token.name} has no configured direct-fire weapons.` };
  }

  const state = getTurnState();
  const activeFleet = state.fleets?.[state.activeFleetIndex] ?? null;
  const fleetId = getTokenFleetId(token);
  const fleet = state.fleets?.find(item => item.id === fleetId) ?? null;
  const combatState = getCombatState(token);
  const phase = PHASES.find(item => item.id === state.phase)?.label ?? state.phase;
  const warnings = [];
  let blocked = false;

  const restrict = message => {
    if (game.user?.isGM) warnings.push(`${message} Gamemaster preview override is available.`);
    else blocked = true;
  };

  if (!state.battleStarted) {
    warnings.push("No battle is currently running. Shooting preview is available for testing.");
  } else {
    if (state.phase !== "shooting") restrict(`The current phase is ${phase}, not Shooting.`);
    if (!fleetId) restrict(`${token.name} is not assigned to a fleet.`);
    else if (activeFleet && fleetId !== activeFleet.id) {
      restrict(`${token.name} belongs to ${fleet?.name ?? fleetId}, but ${activeFleet.name} is active.`);
    }
  }

  if (combatState?.outOfAction) restrict(`${token.name} is out of action.`);
  if (blocked) return { ok: false, error: "This ship cannot fire during the current battle state." };

  return {
    ok: true,
    token,
    actor,
    shipData,
    weapons: shipData.weapons,
    state,
    activeFleet,
    fleet,
    fleetId,
    combatState,
    warnings
  };
}

export function analyseDirectFire(attacker, target, weapon) {
  if (!attacker || !target || !weapon) throw new Error("Attacker, target and weapon are required.");
  if (attacker.id === target.id) throw new Error("A ship cannot target itself.");

  const targetData = getShipData(target);
  const targetCombatState = getCombatState(target);
  if (!targetData || !targetCombatState) {
    throw new Error(`${target.name} is not a configured ship with combat statistics.`);
  }

  const scale = pixelsPerCm();
  const dx = Number(target.center.x) - Number(attacker.center.x);
  const dy = Number(target.center.y) - Number(attacker.center.y);
  const centerDistancePixels = Math.hypot(dx, dy);
  const rangeCm = centerDistancePixels / scale;
  const maximumRangeCm = Number(weapon.rangeCm);

  const bearing = headingToPoint(attacker.center, target.center);
  const weaponDirectionFromProw = Number(weapon.directionDegrees) + 90;
  const weaponHeading = Number(attacker.document.rotation ?? 0) + weaponDirectionFromProw;
  const arcDifference = signedAngleDifference(bearing, weaponHeading);
  const inArc = Math.abs(arcDifference) <= Number(weapon.arcDegrees) / 2 + 0.000001;
  const inRange = Number.isFinite(maximumRangeCm) && rangeCm <= maximumRangeCm + 0.000001;

  const targetBearingToAttacker = headingToPoint(target.center, attacker.center);
  const targetRelativeBearing = signedAngleDifference(
    targetBearingToAttacker,
    Number(target.document.rotation ?? 0)
  );
  const absoluteTargetBearing = Math.abs(targetRelativeBearing);
  const targetFacing = absoluteTargetBearing <= 45
    ? "Prow"
    : absoluteTargetBearing >= 135
      ? "Aft"
      : targetRelativeBearing > 0
        ? "Starboard beam"
        : "Port beam";

  const attackerFleetId = getTokenFleetId(attacker);
  const targetFleetId = getTokenFleetId(target);
  const sameFleet = Boolean(attackerFleetId && targetFleetId && attackerFleetId === targetFleetId);
  const warnings = [];
  if (!targetFleetId) warnings.push(`${target.name} is not assigned to a fleet.`);
  if (sameFleet) warnings.push(`${target.name} belongs to the firing ship's fleet.`);
  if (targetCombatState.outOfAction) warnings.push(`${target.name} is already out of action.`);

  return {
    attackerId: attacker.id,
    targetId: target.id,
    targetName: target.name,
    weapon,
    weaponType: weaponTypeLabel(weapon),
    rangeCm,
    rangeLabel: rangeCm.toFixed(1),
    maximumRangeCm,
    inRange,
    inArc,
    targetFacing,
    targetCombatState,
    sameFleet,
    warnings,
    legalTarget: !sameFleet && Boolean(targetFleetId) && !targetCombatState.outOfAction,
    legal: inRange && inArc && !sameFleet && Boolean(targetFleetId) && !targetCombatState.outOfAction
  };
}

export function previewDirectFire(attacker, target, weapon) {
  const context = getShootingContext(attacker);
  if (!context.ok) throw new Error(context.error);
  const analysis = analyseDirectFire(context.token, target, weapon);
  drawWeaponArc(context.token, weapon);
  return analysis;
}

export async function openShootingPlanner(token = canvas.tokens.controlled[0]) {
  const controlled = canvas.tokens?.controlled ?? [];
  if (!token || (token === controlled[0] && controlled.length !== 1)) {
    ui.notifications.warn("Please select exactly one configured firing ship.");
    return false;
  }

  const context = getShootingContext(token);
  if (!context.ok) {
    ui.notifications.warn(context.error);
    return false;
  }

  const { openShootingPlannerApplication } = await import("./shooting-app.js");
  await openShootingPlannerApplication(context.token);
  return true;
}
