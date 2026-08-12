import { getShipData, getBaseActor } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getTurnState, PHASES } from "./turn-manager.js";
import {
  applyHitDamage,
  getCombatState,
  previewHitDamage
} from "./combat-state.js";
import { drawWeaponArc } from "./weapon-arcs.js";
import { calculateBatteryDice } from "./gunnery-table.js";
import { MODULE_ID } from "./constants.js";

const FIRED_WEAPONS_FLAG = "firedWeapons";

function shootingActivationKey(state = getTurnState()) {
  if (!state.battleStarted) return null;
  return `${state.battleId ?? "legacy-battle"}:${state.round}:${state.activeFleetIndex}:shooting`;
}

function firedWeaponIds(token, state = getTurnState()) {
  const activationKey = shootingActivationKey(state);
  const stored = token?.document?.getFlag(MODULE_ID, FIRED_WEAPONS_FLAG);
  if (!activationKey || stored?.activationKey !== activationKey) return [];
  return Array.isArray(stored.weaponIds) ? stored.weaponIds.map(String) : [];
}

export function hasWeaponFired(token, weaponId, state = getTurnState()) {
  return firedWeaponIds(token, state).includes(String(weaponId));
}

async function markWeaponFired(token, weaponId, state = getTurnState()) {
  const activationKey = shootingActivationKey(state);
  if (!activationKey || state.phase !== "shooting") return false;

  const weaponIds = [...new Set([...firedWeaponIds(token, state), String(weaponId)])];
  await token.document.setFlag(MODULE_ID, FIRED_WEAPONS_FLAG, { activationKey, weaponIds });
  return true;
}

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

function targetClassFor(targetData) {
  const configured = String(targetData?.stats?.targetClass ?? "").toLowerCase();
  if (["capital", "escort", "defence", "ordnance"].includes(configured)) return configured;
  if (/escort/i.test(String(targetData?.shipClass ?? ""))) return "escort";
  return "capital";
}

function armourTargetNumber(combatState, targetFacing) {
  const armour = targetFacing === "Prow"
    ? combatState?.armourFront
    : combatState?.armourOther;
  const match = String(armour ?? combatState?.armour ?? "").match(/\d+/);
  const value = Number(match?.[0]);
  if (!(value >= 2 && value <= 6)) throw new Error("The target does not have a valid Armour value.");
  return value;
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
  const orientation = targetFacing === "Prow"
    ? "closing"
    : targetFacing === "Aft"
      ? "moving-away"
      : "abeam";
  const targetArmour = targetFacing === "Prow"
    ? targetCombatState.armourFront
    : targetCombatState.armourOther;

  const attackerFleetId = getTokenFleetId(attacker);
  const targetFleetId = getTokenFleetId(target);
  const sameFleet = Boolean(attackerFleetId && targetFleetId && attackerFleetId === targetFleetId);
  const warnings = [];
  const weaponFired = hasWeaponFired(attacker, weapon.id);
  if (!targetFleetId) warnings.push(`${target.name} is not assigned to a fleet.`);
  if (sameFleet) warnings.push(`${target.name} belongs to the firing ship's fleet.`);
  if (targetCombatState.outOfAction) warnings.push(`${target.name} is already out of action.`);
  if (weaponFired) warnings.push(`${weapon.name} has already fired during this Shooting phase.`);

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
    targetArmour,
    orientation,
    targetClass: targetClassFor(targetData),
    targetCombatState,
    sameFleet,
    weaponFired,
    warnings,
    legalTarget: !sameFleet && Boolean(targetFleetId) && !targetCombatState.outOfAction,
    legal: inRange && inArc && !sameFleet && Boolean(targetFleetId) && !targetCombatState.outOfAction && !weaponFired
  };
}

export async function resolveDirectFire(analysis, {
  interveningBlastMarkers = false,
  countsAsDefences = false
} = {}) {
  if (!analysis?.weapon || !analysis?.targetId) throw new Error("Check a firing solution before rolling.");

  const attacker = canvas.tokens?.get(analysis.attackerId);
  const target = canvas.tokens?.get(analysis.targetId);
  if (!attacker) throw new Error("The firing ship is no longer on this Scene.");
  if (!target) throw new Error("The target is no longer on this Scene.");

  const currentContext = getShootingContext(attacker);
  if (!currentContext.ok) throw new Error(currentContext.error);
  const currentWeapon = currentContext.weapons.find(item => item.id === analysis.weapon.id);
  if (!currentWeapon) throw new Error("The selected weapon is no longer configured on this ship.");
  analysis = analyseDirectFire(attacker, target, currentWeapon);
  if (analysis.weaponFired) {
    throw new Error(`${currentWeapon.name} has already fired during this Shooting phase.`);
  }
  if (!analysis.legal) {
    throw new Error("This firing solution is not legal. The attack cannot be resolved.");
  }

  const weapon = analysis.weapon;
  const type = String(weapon.type ?? "").toLowerCase();
  const strength = Math.trunc(Number(weapon.strength));
  if (!(strength > 0)) throw new Error(`${weapon.name} does not have a valid Strength or Firepower value.`);

  let attackDice;
  let batteryCalculation = null;
  let hitTarget;

  if (type === "lance") {
    attackDice = strength;
    hitTarget = 4;
  } else if (type === "battery") {
    batteryCalculation = calculateBatteryDice({
      firepower: strength,
      targetClass: analysis.targetClass,
      orientation: analysis.orientation,
      rangeCm: analysis.rangeCm,
      interveningBlastMarkers,
      countsAsDefences
    });
    attackDice = batteryCalculation.attackDice;
    hitTarget = armourTargetNumber(analysis.targetCombatState, analysis.targetFacing);
  } else {
    throw new Error(`${weapon.name} is not configured as a battery or lance weapon.`);
  }

  const roll = await new Roll(attackDice > 0 ? `${attackDice}d6` : "0").evaluate();
  const results = roll.dice.flatMap(die => die.results.map(result => Number(result.result)));
  const hits = results.filter(result => result >= hitTarget).length;
  const damage = previewHitDamage(target, hits);
  const typeLabel = type === "lance" ? "Lance" : "Weapons battery";

  await markWeaponFired(attacker, weapon.id, currentContext.state);

  const escape = value => foundry.utils.escapeHTML(String(value));
  const diceLabel = results.length > 0 ? results.join(", ") : "No dice";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    content: `
      <div class="bfg-shooting-chat-result">
        <strong>${escape(analysis.weapon.name)}</strong> (${escape(typeLabel)}) firing at
        <strong>${escape(analysis.targetName)}</strong>.<br>
        Dice (${attackDice}d6): <strong>${escape(diceLabel)}</strong><br>
        Required: <strong>${hitTarget}+</strong>; Hits: <strong>${hits}</strong>
      </div>`
  });

  return {
    attackerId: analysis.attackerId,
    targetId: analysis.targetId,
    targetName: analysis.targetName,
    weaponId: weapon.id,
    weaponName: weapon.name,
    weaponType: type,
    attackDice,
    hitTarget,
    results,
    hits,
    batteryCalculation,
    interveningBlastMarkers: Boolean(interveningBlastMarkers),
    countsAsDefences: Boolean(countsAsDefences),
    damage
  };
}

export async function commitDirectFireDamage(resolution) {
  if (!resolution?.targetId) throw new Error("Roll an attack before committing damage.");
  const target = canvas.tokens?.get(resolution.targetId);
  if (!target) throw new Error("The target is no longer on this Scene.");

  const current = getCombatState(target);
  const before = resolution.damage?.before;
  if (
    !current || !before
    || current.currentHits !== before.currentHits
    || current.currentShields !== before.currentShields
  ) {
    throw new Error("The target's combat state changed after the roll. Resolve the attack again.");
  }

  return applyHitDamage(target, resolution.hits);
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
