import { getShipData, getBaseActor } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { canUserControlToken } from "./fleet-control.js";
import { getTurnState, PHASES } from "./turn-manager.js";
import {
  getCombatState,
  halveRoundedUp,
  previewHitDamage,
  setCombatState
} from "./combat-state.js";
import { drawWeaponArc } from "./weapon-arcs.js";
import { calculateBatteryDice } from "./gunnery-table.js";
import { MODULE_ID } from "./constants.js";
import {
  getCriticalState,
  isWeaponDisabledByCritical,
  rollCriticalHits,
  setCriticalState
} from "./critical-hits.js";
import {
  getCatastrophicState,
  rollCatastrophicDamage,
  setCatastrophicState
} from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { getOrdnanceMarker } from "./ordnance.js";
import { getBoardingState, hasDeclaredBoarding, isBoardingParticipant } from "./boarding.js";
import { effectiveWeaponStrength, getSpecialOrder, resolveBraceReaction, rollBraceSaves } from "./special-orders.js";
import { getEffectiveLeadership } from "./leadership.js";

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

export async function markWeaponFired(token, weaponId, state = getTurnState()) {
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
  if (type === "nova-cannon") return "Nova Cannon";
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

function directWeaponGeometry(attacker, target, weapon) {
  const scale = pixelsPerCm();
  const rangeCm = Math.hypot(Number(target.center.x) - Number(attacker.center.x), Number(target.center.y) - Number(attacker.center.y)) / scale;
  const bearing = headingToPoint(attacker.center, target.center);
  const weaponHeading = Number(attacker.document.rotation ?? 0) + Number(weapon.directionDegrees) + 90;
  const inArc = Math.abs(signedAngleDifference(bearing, weaponHeading)) <= Number(weapon.arcDegrees) / 2 + 0.000001;
  const minimumRangeCm = Math.max(0, Number(weapon.minimumRangeCm ?? 0));
  const maximumRangeCm = Number(weapon.rangeCm);
  return { rangeCm, inArc, inRange: rangeCm >= minimumRangeCm - 0.000001 && rangeCm <= maximumRangeCm + 0.000001 };
}

/** Closest enemy ship this weapon can legally engage. Ordnance is deliberately ignored. */
export function getClosestPriorityTarget(attacker, weapon) {
  const attackerFleetId = getTokenFleetId(attacker);
  return (canvas.tokens?.placeables ?? [])
    .filter(target => {
      if (target.id === attacker.id || !getShipData(target)) return false;
      const targetFleetId = getTokenFleetId(target);
      if (!attackerFleetId || !targetFleetId || targetFleetId === attackerFleetId) return false;
      const combat = getCombatState(target);
      if (!combat || (combat.outOfAction && !combat.hulk) || isBoardingParticipant(target)) return false;
      const geometry = directWeaponGeometry(attacker, target, weapon);
      return geometry.inArc && geometry.inRange;
    })
    .map(target => ({ target, rangeCm: directWeaponGeometry(attacker, target, weapon).rangeCm }))
    .sort((first, second) => first.rangeCm - second.rangeCm)[0]?.target ?? null;
}

export function getSelectedShootingTarget() {
  const targets = getSelectedShootingTargets();
  if (targets.length === 0) {
    const visiblyTargeted = (canvas.tokens?.placeables ?? []).filter(token => token.targeted?.has?.(game.user));
    return visiblyTargeted.length === 1 ? visiblyTargeted[0] : null;
  }
  return targets.length === 1 ? targets[0] : null;
}

export function getSelectedShootingTargets() {
  const targets = [...(game.user?.targets ?? [])];
  if (targets.length > 0) return targets;
  return (canvas.tokens?.placeables ?? []).filter(token => token.targeted?.has?.(game.user));
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
  const criticalState = getCriticalState(token);
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
    if (!canUserControlToken(token, game.user, state)) restrict(`You are not assigned to control ${fleet?.name ?? "this fleet"}.`);
    if (state.phase !== "shooting") restrict(`The current phase is ${phase}, not Shooting.`);
    if (!fleetId) restrict(`${token.name} is not assigned to a fleet.`);
    else if (activeFleet && fleetId !== activeFleet.id) {
      restrict(`${token.name} belongs to ${fleet?.name ?? fleetId}, but ${activeFleet.name} is active.`);
    }
  }

  if (combatState?.outOfAction) restrict(`${token.name} is out of action.`);
  const boarding = getBoardingState(token);
  if (hasDeclaredBoarding(token) || boarding?.drawn) restrict(`${token.name} is committed to a boarding action.`);
  if (blocked) return { ok: false, error: "This ship cannot fire during the current battle state." };

  return {
    ok: true,
    token,
    actor,
    shipData,
    weapons: shipData.weapons,
    criticalState,
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
  const targetOrdnance = getOrdnanceMarker(target);
  const attackerCombatState = getCombatState(attacker);
  const targetCombatState = getCombatState(target);
  const isOrdnance = ["attackCraft", "torpedo"].includes(targetOrdnance?.category);
  if ((!targetData || !targetCombatState) && !isOrdnance) {
    throw new Error(`${target.name} is not a configured ship or ordnance marker.`);
  }

  const scale = pixelsPerCm();
  const dx = Number(target.center.x) - Number(attacker.center.x);
  const dy = Number(target.center.y) - Number(attacker.center.y);
  const centerDistancePixels = Math.hypot(dx, dy);
  const rangeCm = centerDistancePixels / scale;
  const maximumRangeCm = Number(weapon.rangeCm);
  const minimumRangeCm = Math.max(0, Number(weapon.minimumRangeCm ?? 0));

  const bearing = headingToPoint(attacker.center, target.center);
  const weaponDirectionFromProw = Number(weapon.directionDegrees) + 90;
  const weaponHeading = Number(attacker.document.rotation ?? 0) + weaponDirectionFromProw;
  const arcDifference = signedAngleDifference(bearing, weaponHeading);
  const inArc = Math.abs(arcDifference) <= Number(weapon.arcDegrees) / 2 + 0.000001;
  const inRange = Number.isFinite(maximumRangeCm)
    && rangeCm >= minimumRangeCm - 0.000001
    && rangeCm <= maximumRangeCm + 0.000001;

  const targetBearingToAttacker = headingToPoint(target.center, attacker.center);
  const targetRelativeBearing = signedAngleDifference(
    targetBearingToAttacker,
    Number(target.document.rotation ?? 0)
  );
  const absoluteTargetBearing = Math.abs(targetRelativeBearing);
  const targetFacing = isOrdnance ? "Not applicable" : absoluteTargetBearing <= 45
    ? "Prow"
    : absoluteTargetBearing >= 135
      ? "Aft"
      : targetRelativeBearing > 0
        ? "Starboard beam"
        : "Port beam";
  const orientation = isOrdnance ? "ignored" : targetFacing === "Prow"
    ? "closing"
    : targetFacing === "Aft"
      ? "moving-away"
      : "abeam";
  const targetArmour = isOrdnance ? "6+" : targetFacing === "Prow"
    ? targetCombatState.armourFront
    : targetCombatState.armourOther;

  const attackerFleetId = getTokenFleetId(attacker);
  const targetFleetId = isOrdnance ? targetOrdnance.fleetId : getTokenFleetId(target);
  const sameFleet = Boolean(attackerFleetId && targetFleetId && attackerFleetId === targetFleetId);
  const warnings = [];
  const weaponFired = hasWeaponFired(attacker, weapon.id);
  const weaponDisabled = isWeaponDisabledByCritical(weapon, getCriticalState(attacker));
  const novaCannon = String(weapon.type ?? "").toLowerCase() === "nova-cannon";
  const novaDisabled = novaCannon && Boolean(attackerCombatState?.novaCannonDisabled);
  const novaOrderBlocked = novaCannon && ["all-ahead-full", "burn-retros", "come-to-new-heading", "brace-for-impact"].includes(getSpecialOrder(attacker)?.id);
  const priorityTarget = isOrdnance ? null : getClosestPriorityTarget(attacker, weapon);
  const targetPriorityRequired = Boolean(priorityTarget && priorityTarget.id !== target.id);
  const profileStrength = Math.trunc(Number(weapon.strength));
  const effectiveStrength = effectiveWeaponStrength(attacker, profileStrength);
  if (!targetFleetId) warnings.push(`${target.name} is not assigned to a fleet.`);
  if (sameFleet) warnings.push(`${target.name} belongs to the firing ship's fleet.`);
  if (!isOrdnance && isBoardingParticipant(target)) warnings.push(`${target.name} is involved in a boarding action and cannot be fired upon.`);
  if (targetCombatState?.hulk) warnings.push(`${target.name} is a hulk; hits will trigger one Catastrophic Damage roll.`);
  else if (targetCombatState?.outOfAction) warnings.push(`${target.name} is already out of action and cannot be targeted.`);
  if (weaponFired) warnings.push(`${weapon.name} has already fired during this Shooting phase.`);
  if (weaponDisabled) warnings.push(`${weapon.name} cannot fire because its armament is critically damaged.`);
  if (novaDisabled) warnings.push(`${weapon.name} cannot fire while the ship is crippled.`);
  if (novaOrderBlocked) warnings.push(`${weapon.name} cannot fire under the ship's current Special Order.`);

  return {
    attackerId: attacker.id,
    targetId: target.id,
    targetName: target.name,
    weapon,
    profileStrength,
    effectiveStrength,
    attackerCrippled: Boolean(attackerCombatState?.crippled),
    attackerSpecialOrder: getSpecialOrder(attacker)?.name ?? null,
    weaponType: weaponTypeLabel(weapon),
    rangeCm,
    rangeLabel: rangeCm.toFixed(1),
    maximumRangeCm,
    minimumRangeCm,
    inRange,
    inArc,
    targetFacing,
    targetArmour,
    orientation,
    targetClass: isOrdnance ? "ordnance" : targetClassFor(targetData),
    targetCombatState,
    targetOrdnance,
    isOrdnance,
    sameFleet,
    weaponFired,
    weaponDisabled,
    novaDisabled,
    novaOrderBlocked,
    priorityTargetId: priorityTarget?.id ?? null,
    priorityTargetName: priorityTarget?.name ?? null,
    targetPriorityRequired,
    warnings,
    legalTarget: !sameFleet && Boolean(targetFleetId) && (isOrdnance || (!isBoardingParticipant(target) && (!targetCombatState.outOfAction || targetCombatState.hulk))),
    legal: inRange && inArc && !sameFleet && Boolean(targetFleetId) && (isOrdnance || (!isBoardingParticipant(target) && (!targetCombatState.outOfAction || targetCombatState.hulk))) && !weaponFired && !weaponDisabled && !novaDisabled && !novaOrderBlocked
  };
}

export async function resolveDirectFire(analysis, {
  interveningBlastMarkers = false,
  countsAsDefences = false,
  targetBrace = false,
  targetBraceBlastContact = false,
  priorityTargetBrace = false,
  priorityTargetBraceBlastContact = false
} = {}) {
  if (!analysis?.weapon || !analysis?.targetId) throw new Error("Check a firing solution before rolling.");

  const attacker = canvas.tokens?.get(analysis.attackerId);
  let target = canvas.tokens?.get(analysis.targetId);
  if (!attacker) throw new Error("The firing ship is no longer on this Scene.");
  if (!target) throw new Error("The target is no longer on this Scene.");

  const currentContext = getShootingContext(attacker);
  if (!currentContext.ok) throw new Error(currentContext.error);
  if (currentContext.combatState?.outOfAction) throw new Error("A hulk or destroyed ship cannot fire.");
  const currentWeapon = currentContext.weapons.find(item => item.id === analysis.weapon.id);
  if (!currentWeapon) throw new Error("The selected weapon is no longer configured on this ship.");
  analysis = analyseDirectFire(attacker, target, currentWeapon);
  if (analysis.weaponFired) {
    throw new Error(`${currentWeapon.name} has already fired during this Shooting phase.`);
  }
  if (analysis.weaponDisabled) {
    throw new Error(`${currentWeapon.name} cannot fire because its armament is critically damaged.`);
  }
  if (!analysis.legal) {
    throw new Error("This firing solution is not legal. The attack cannot be resolved.");
  }

  let priorityCheck = null;
  if (!analysis.isOrdnance && analysis.targetPriorityRequired) {
    const priorityTarget = canvas.tokens?.get(analysis.priorityTargetId);
    if (!priorityTarget) throw new Error("The priority target is no longer on this Scene.");
    const leadership = getEffectiveLeadership(attacker);
    const roll = await new Roll("2d6").evaluate();
    const total = Number(roll.total);
    const passed = total <= leadership;
    await publishBFGDice(roll, {
      speaker: ChatMessage.getSpeaker({ token: attacker.document }),
      flavor: `${currentWeapon.name}: target-priority Leadership test`,
      details: `Total ${total} against Leadership ${leadership}: ${passed ? "PASS" : "FAIL; redirected to the closest eligible enemy"}.`
    });
    priorityCheck = { dice: diceFaces(roll), total, leadership, passed };
    if (!priorityCheck.passed) {
      target = priorityTarget;
      analysis = analyseDirectFire(attacker, target, currentWeapon);
    }
  }

  if (!analysis.isOrdnance) {
    const redirected = Boolean(priorityCheck && !priorityCheck.passed);
    await resolveBraceReaction(target, {
      brace: redirected ? priorityTargetBrace : targetBrace,
      blastContact: redirected ? priorityTargetBraceBlastContact : targetBraceBlastContact
    });
  }

  const weapon = analysis.weapon;
  const type = String(weapon.type ?? "").toLowerCase();
  const profileStrength = Math.trunc(Number(weapon.strength));
  const strength = effectiveWeaponStrength(attacker, profileStrength);
  if (!(strength > 0)) throw new Error(`${weapon.name} does not have a valid Strength or Firepower value.`);

  let attackDice;
  let batteryCalculation = null;
  let hitTarget;

  if (type === "lance") {
    attackDice = strength;
    hitTarget = analysis.isOrdnance ? 6 : 4;
  } else if (type === "battery") {
    batteryCalculation = calculateBatteryDice({
      firepower: strength,
      targetClass: analysis.targetClass,
      orientation: analysis.orientation,
      rangeCm: analysis.rangeCm,
      interveningBlastMarkers,
      countsAsDefences: analysis.isOrdnance ? false : countsAsDefences,
      ignoreLongRangeShift: Boolean(weapon.ignoreLongRangeShift)
    });
    attackDice = batteryCalculation.attackDice;
    hitTarget = analysis.isOrdnance ? 6 : armourTargetNumber(analysis.targetCombatState, analysis.targetFacing);
  } else {
    throw new Error(`${weapon.name} is not configured as a battery or lance weapon.`);
  }

  const roll = await new Roll(attackDice > 0 ? `${attackDice}d6` : "0").evaluate();
  await publishBFGDice(roll, {
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    flavor: `${weapon.name} firing at ${analysis.targetName}`
  });
  let results = diceFaces(roll);
  const lockOn = getSpecialOrder(attacker)?.id === "lock-on";
  const misses = results.filter(result => result < hitTarget).length;
  if (lockOn && misses > 0) {
    const reroll = await new Roll(`${misses}d6`).evaluate();
    await publishBFGDice(reroll, {
      speaker: ChatMessage.getSpeaker({ token: attacker.document }),
      flavor: `${weapon.name}: Lock On rerolls`
    });
    results = [...results.filter(result => result >= hitTarget), ...diceFaces(reroll)];
  }
  const hits = results.filter(result => result >= hitTarget).length;
  if (analysis.isOrdnance) {
    const ordnanceHit = hits > 0;
    await markWeaponFired(attacker, weapon.id, currentContext.state);
    const escape = value => foundry.utils.escapeHTML(String(value));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: attacker.document }),
      content: `<div class="bfg-shooting-chat-result"><strong>${escape(weapon.name)}</strong> firing at <strong>${escape(analysis.targetName)}</strong>.<br>Dice (${attackDice}d6): <strong>${escape(results.join(", ") || "No dice")}</strong><br>Required: <strong>6+</strong>; Hits: <strong>${hits}</strong><br>${ordnanceHit ? "The ordnance marker or entire attack-craft wave is destroyed." : "The ordnance remains in play."}</div>`
    });
    return {
      attackerId: analysis.attackerId, targetId: analysis.targetId, targetName: analysis.targetName,
      weaponId: weapon.id, weaponName: weapon.name, weaponType: type,
      attackDice, hitTarget, results, hits, batteryCalculation,
      isOrdnance: true, ordnanceHit,
      ordnanceCategory: analysis.targetOrdnance.category,
      ordnanceWaveId: analysis.targetOrdnance.waveId ?? null,
      interveningBlastMarkers: Boolean(interveningBlastMarkers), countsAsDefences: false
    };
  }
  const attackingHulk = analysis.targetCombatState.hulk;
  let damage = previewHitDamage(target, attackingHulk ? 0 : hits);
  const brace = attackingHulk ? { dice: [], saved: 0, unsaved: 0 } : await rollBraceSaves(target, damage.hullHits);
  if (brace.saved > 0) damage = previewHitDamage(target, damage.shieldHits + brace.unsaved);
  const critical = attackingHulk
    ? await rollCriticalHits(target, 0)
    : await rollCriticalHits(target, damage.hullHits);
  const remainingHull = attackingHulk
    ? 0
    : critical.escortDestroyed
      ? 0
      : Math.max(0, damage.after.currentHits - critical.extraDamage);
  damage.critical = critical;
  damage.brace = brace;
  damage.extraCriticalDamage = critical.extraDamage;
  damage.after.currentHits = remainingHull;
  damage.after.crippled = remainingHull > 0 && remainingHull <= damage.before.maximumHits / 2;
  const resultingMaximumShields = critical.after.permanent.includes("shields-collapse")
    ? 0
    : damage.after.crippled
      ? halveRoundedUp(damage.before.profileMaximumShields)
      : damage.before.profileMaximumShields;
  damage.after.currentShields = Math.min(damage.after.currentShields, resultingMaximumShields);
  damage.after.outOfAction = remainingHull <= 0;
  damage.catastrophic = (attackingHulk && hits > 0) || (!damage.before.outOfAction && damage.after.outOfAction)
    ? await rollCatastrophicDamage(target)
    : null;
  const typeLabel = type === "lance" ? "Lance" : "Weapons battery";

  await markWeaponFired(attacker, weapon.id, currentContext.state);

  const escape = value => foundry.utils.escapeHTML(String(value));
  const diceLabel = results.length > 0 ? results.join(", ") : "No dice";
  const criticalLabel = critical.escortDestroyed
    ? "Escort destroyed by critical hit"
    : critical.results.length > 0
      ? critical.results.map(result => `2D6 ${result.rolledTotal}: ${result.name}${result.shifted ? ` (applied as ${result.appliedTotal})` : ""}${result.extraDamage ? ` (+${result.extraDamage} damage)` : ""}`).join("; ")
      : "None";
  const catastrophicLabel = damage.catastrophic
    ? `2D6 ${damage.catastrophic.tableTotal ?? "-"}: ${damage.catastrophic.name}. ${damage.catastrophic.instruction}`
    : "None";
  const priorityLabel = priorityCheck
    ? `Target-priority test: ${priorityCheck.dice.join(", ")} = ${priorityCheck.total} against Leadership ${priorityCheck.leadership}: ${priorityCheck.passed ? "passed" : `failed; redirected to ${escape(analysis.targetName)}`}.<br>`
    : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    content: `
      <div class="bfg-shooting-chat-result">
        <strong>${escape(analysis.weapon.name)}</strong> (${escape(typeLabel)}) firing at
        <strong>${escape(analysis.targetName)}</strong>.<br>
        ${priorityLabel}
        Dice (${attackDice}d6): <strong>${escape(diceLabel)}</strong><br>
        Required: <strong>${hitTarget}+</strong>; Hits: <strong>${hits}</strong>
        <br>Shield damage: <strong>${damage.shieldHits}</strong>; Hull damage: <strong>${damage.hullHits}</strong>
        <br>Brace saves: <strong>${escape(brace.dice.join(", ") || "None")}</strong>; Damage saved: <strong>${brace.saved}</strong>
        <br>Critical checks: <strong>${escape(critical.checkResults.join(", ") || "None")}</strong>
        <br>Critical effects: <strong>${escape(criticalLabel)}</strong>
        <br>Catastrophic damage: <strong>${escape(catastrophicLabel)}</strong>
        <br>Remaining shields: <strong>${damage.after.currentShields}</strong>; Remaining hull: <strong>${damage.after.currentHits}</strong>
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
    priorityCheck,
    damage
  };
}

export async function commitDirectFireDamage(resolution) {
  if (!resolution?.targetId) throw new Error("Roll an attack before committing damage.");
  const target = canvas.tokens?.get(resolution.targetId);
  if (!target) throw new Error("The target is no longer on this Scene.");

  if (resolution.isOrdnance) {
    const marker = getOrdnanceMarker(target);
    if (!marker || marker.category !== resolution.ordnanceCategory || (marker.waveId ?? null) !== resolution.ordnanceWaveId) {
      throw new Error("The ordnance target changed after the roll. Resolve the attack again.");
    }
    if (!resolution.ordnanceHit) return { removed: false };
    const targets = marker.category === "attackCraft"
      ? (canvas.tokens?.placeables ?? []).filter(token => {
          const other = getOrdnanceMarker(token);
          return other?.category === "attackCraft" && other.waveId === marker.waveId;
        })
      : [target];
    await canvas.scene.deleteEmbeddedDocuments("Token", targets.map(token => token.document.id));
    return { removed: true, count: targets.length };
  }

  const current = getCombatState(target);
  const before = resolution.damage?.before;
  if (
    !current || !before
    || current.currentHits !== before.currentHits
    || current.currentShields !== before.currentShields
    || JSON.stringify(getCriticalState(target)) !== JSON.stringify(resolution.damage?.critical?.before)
    || JSON.stringify(getCatastrophicState(target)) !== JSON.stringify(before.catastrophicState)
  ) {
    throw new Error("The target's combat state changed after the roll. Resolve the attack again.");
  }

  const critical = resolution.damage.critical;
  await setCriticalState(target, critical.after);
  if (resolution.damage.catastrophic) {
    await setCatastrophicState(target, resolution.damage.catastrophic);
  }
  const updated = await setCombatState(target, resolution.damage.after);
  return updated ? { ...resolution.damage, updated } : false;
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
