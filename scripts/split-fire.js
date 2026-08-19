import {
  analyseDirectFire,
  getShootingContext,
  markWeaponFired
} from "./shooting.js";
import { calculateBatteryDice } from "./gunnery-table.js";
import { getCombatState, halveRoundedUp, previewHitDamage, setCombatState } from "./combat-state.js";
import { getCriticalState, rollCriticalHits, setCriticalState } from "./critical-hits.js";
import { getCatastrophicState, rollCatastrophicDamage, setCatastrophicState } from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { effectiveWeaponStrength, getSpecialOrder, resolveBraceReaction, rollBraceSaves } from "./special-orders.js";
import { getEffectiveLeadership } from "./leadership.js";
import { getOrdnanceMarker } from "./ordnance.js";

function armourTargetNumber(combatState, targetFacing) {
  const armour = targetFacing === "Prow" ? combatState?.armourFront : combatState?.armourOther;
  const value = Number(String(armour ?? combatState?.armour ?? "").match(/\d+/)?.[0]);
  if (!(value >= 2 && value <= 6)) throw new Error("The target does not have a valid Armour value.");
  return value;
}

function stateSnapshot(target) {
  return {
    combat: getCombatState(target),
    critical: getCriticalState(target),
    catastrophic: getCatastrophicState(target)
  };
}

function sameState(target, snapshot) {
  const current = stateSnapshot(target);
  return current.combat?.currentHits === snapshot.combat?.currentHits
    && current.combat?.currentShields === snapshot.combat?.currentShields
    && JSON.stringify(current.critical) === JSON.stringify(snapshot.critical)
    && JSON.stringify(current.catastrophic) === JSON.stringify(snapshot.catastrophic);
}

function logicalTargetKey(analysis) {
  if (analysis.isOrdnance && analysis.targetOrdnance?.category === "attackCraft") {
    return `wave:${analysis.targetOrdnance.waveId ?? analysis.targetId}`;
  }
  return `token:${analysis.targetId}`;
}

function closestEligibleOrdnance(attacker, weapon) {
  return (canvas.tokens?.placeables ?? [])
    .map(target => {
      try {
        const analysis = analyseDirectFire(attacker, target, weapon);
        return analysis.isOrdnance && analysis.legal ? analysis : null;
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((first, second) => first.rangeCm - second.rangeCm)[0] ?? null;
}

function splitTargetAnalysis(attacker, target, weapon) {
  const analysis = analyseDirectFire(attacker, target, weapon);
  if (!analysis.isOrdnance) return analysis;
  const priority = closestEligibleOrdnance(attacker, weapon);
  return {
    ...analysis,
    priorityTargetId: priority?.targetId ?? null,
    priorityTargetName: priority?.targetName ?? null,
    targetPriorityRequired: Boolean(priority && priority.targetId !== analysis.targetId)
  };
}

async function priorityDestination(attacker, weapon, analysis) {
  if (!analysis.targetPriorityRequired) return { analysis, priorityCheck: null };
  const priorityTarget = canvas.tokens?.get(analysis.priorityTargetId);
  if (!priorityTarget) throw new Error("The priority target is no longer on this Scene.");
  const leadership = getEffectiveLeadership(attacker);
  const roll = await new Roll("2d6").evaluate();
  const total = Number(roll.total);
  const passed = total <= leadership;
  await publishBFGDice(roll, {
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    flavor: `${weapon.name}: split-fire target-priority Leadership test`,
    details: `Total ${total} against Leadership ${leadership}: ${passed ? "PASS" : `FAIL; redirected to ${priorityTarget.name}`}.`
  });
  return {
    analysis: passed ? analysis : splitTargetAnalysis(attacker, priorityTarget, weapon),
    priorityCheck: { dice: diceFaces(roll), total, leadership, passed, selectedTargetName: analysis.targetName, finalTargetName: passed ? analysis.targetName : priorityTarget.name }
  };
}

async function rollAllocation(attacker, weapon, analysis, allocation, options, priorityChecks) {
  const target = canvas.tokens?.get(analysis.targetId);
  if (!target) throw new Error("A split-fire target is no longer on this Scene.");
  if (!analysis.isOrdnance) await resolveBraceReaction(target, {
    brace: Boolean(options?.brace),
    blastContact: Boolean(options?.braceBlastContact)
  });

  const type = String(weapon.type ?? "").toLowerCase();
  let attackDice;
  let batteryCalculation = null;
  let hitTarget;
  if (type === "lance") {
    attackDice = allocation;
    hitTarget = analysis.isOrdnance ? 6 : 4;
  } else {
    batteryCalculation = calculateBatteryDice({
      firepower: allocation,
      targetClass: analysis.targetClass,
      orientation: analysis.orientation,
      rangeCm: analysis.rangeCm,
      interveningBlastMarkers: Boolean(options?.interveningBlastMarkers),
      countsAsDefences: analysis.isOrdnance ? false : Boolean(options?.countsAsDefences),
      ignoreLongRangeShift: Boolean(weapon.ignoreLongRangeShift)
    });
    attackDice = batteryCalculation.attackDice;
    hitTarget = analysis.isOrdnance ? 6 : armourTargetNumber(analysis.targetCombatState, analysis.targetFacing);
  }

  const roll = await new Roll(attackDice > 0 ? `${attackDice}d6` : "0").evaluate();
  await publishBFGDice(roll, {
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    flavor: `${weapon.name} split fire at ${analysis.targetName}`
  });
  let results = diceFaces(roll);
  const misses = results.filter(value => value < hitTarget).length;
  if (getSpecialOrder(attacker)?.id === "lock-on" && misses > 0) {
    const reroll = await new Roll(`${misses}d6`).evaluate();
    await publishBFGDice(reroll, {
      speaker: ChatMessage.getSpeaker({ token: attacker.document }),
      flavor: `${weapon.name}: Lock On split-fire rerolls against ${analysis.targetName}`
    });
    results = [...results.filter(value => value >= hitTarget), ...diceFaces(reroll)];
  }
  const hits = results.filter(value => value >= hitTarget).length;

  if (analysis.isOrdnance) {
    return {
      attackerId: attacker.id, targetId: target.id, targetName: target.name,
      weaponId: weapon.id, weaponName: weapon.name, weaponType: type,
      allocatedStrength: allocation, attackDice, hitTarget, results, hits, batteryCalculation,
      priorityChecks, isOrdnance: true, ordnanceHit: hits > 0,
      ordnanceCategory: analysis.targetOrdnance.category,
      ordnanceWaveId: analysis.targetOrdnance.waveId ?? null
    };
  }

  const attackingHulk = analysis.targetCombatState.hulk;
  let damage = previewHitDamage(target, attackingHulk ? 0 : hits);
  const brace = attackingHulk ? { dice: [], saved: 0, unsaved: 0 } : await rollBraceSaves(target, damage.hullHits);
  if (brace.saved > 0) damage = previewHitDamage(target, damage.shieldHits + brace.unsaved);
  const critical = attackingHulk ? await rollCriticalHits(target, 0) : await rollCriticalHits(target, damage.hullHits);
  const remainingHull = attackingHulk ? 0 : critical.escortDestroyed ? 0 : Math.max(0, damage.after.currentHits - critical.extraDamage);
  damage.critical = critical;
  damage.brace = brace;
  damage.extraCriticalDamage = critical.extraDamage;
  damage.after.currentHits = remainingHull;
  damage.after.crippled = remainingHull > 0 && remainingHull <= damage.before.maximumHits / 2;
  const maximumShields = critical.after.permanent.includes("shields-collapse")
    ? 0
    : damage.after.crippled ? halveRoundedUp(damage.before.profileMaximumShields) : damage.before.profileMaximumShields;
  damage.after.currentShields = Math.min(damage.after.currentShields, maximumShields);
  damage.after.outOfAction = remainingHull <= 0;
  damage.catastrophic = (attackingHulk && hits > 0) || (!damage.before.outOfAction && damage.after.outOfAction)
    ? await rollCatastrophicDamage(target)
    : null;
  return {
    attackerId: attacker.id, targetId: target.id, targetName: target.name,
    weaponId: weapon.id, weaponName: weapon.name, weaponType: type,
    allocatedStrength: allocation, attackDice, hitTarget, results, hits, batteryCalculation,
    priorityChecks, isOrdnance: false, damage
  };
}

export function analyseSplitFire(attacker, weapon, targetIds, allocations = {}) {
  const targets = [...new Set(targetIds)].map(id => canvas.tokens?.get(id)).filter(Boolean);
  const analyses = targets.map(target => splitTargetAnalysis(attacker, target, weapon));
  const effectiveStrength = effectiveWeaponStrength(attacker, weapon.strength ?? 0);
  const allocated = analyses.reduce((sum, analysis) => sum + Math.max(0, Number(allocations[analysis.targetId] ?? 0)), 0);
  const positive = analyses.filter(analysis => Number(allocations[analysis.targetId] ?? 0) > 0);
  const logical = new Set(positive.map(logicalTargetKey));
  const warnings = [];
  if (positive.length < 2 || logical.size < 2) warnings.push("Allocate strength to at least two distinct targets.");
  if (allocated !== effectiveStrength) warnings.push(`Allocate exactly ${effectiveStrength} available Strength or Firepower; currently allocated ${allocated}.`);
  if (positive.some(analysis => !analysis.legal)) warnings.push("Every allocated target must have a legal firing solution.");
  return { analyses, effectiveStrength, allocated, positiveTargets: positive.length, logicalTargets: logical.size, warnings, legal: warnings.length === 0 };
}

export async function resolveSplitFire({ attackerId, weaponId, entries }) {
  const attacker = canvas.tokens?.get(attackerId);
  if (!attacker) throw new Error("The firing ship is no longer on this Scene.");
  const context = getShootingContext(attacker);
  if (!context.ok) throw new Error(context.error);
  const weapon = context.weapons.find(item => String(item.id) === String(weaponId));
  if (!weapon) throw new Error("The selected weapon is no longer configured on this ship.");
  const allocations = Object.fromEntries(entries.map(entry => [entry.targetId, Number(entry.allocation)]));
  const split = analyseSplitFire(attacker, weapon, entries.map(entry => entry.targetId), allocations);
  if (!split.legal) throw new Error(split.warnings.join(" "));

  const redirected = [];
  for (const entry of entries.filter(item => Number(item.allocation) > 0)) {
    const initial = splitTargetAnalysis(attacker, canvas.tokens.get(entry.targetId), weapon);
    const destination = await priorityDestination(attacker, weapon, initial);
    redirected.push({ ...entry, analysis: destination.analysis, priorityCheck: destination.priorityCheck });
  }
  const groups = new Map();
  const declaredOptions = new Map(entries.map(entry => [entry.targetId, entry.options ?? {}]));
  for (const entry of redirected) {
    const id = entry.analysis.targetId;
    const group = groups.get(id) ?? {
      analysis: entry.analysis,
      allocation: 0,
      priorityChecks: [],
      options: declaredOptions.get(id) ?? entry.options ?? {}
    };
    group.allocation += Number(entry.allocation);
    if (entry.priorityCheck) group.priorityChecks.push(entry.priorityCheck);
    groups.set(id, group);
  }

  const results = [];
  for (const group of groups.values()) {
    results.push(await rollAllocation(attacker, weapon, group.analysis, group.allocation, group.options, group.priorityChecks));
  }
  await markWeaponFired(attacker, weapon.id, context.state);
  const totalHits = results.reduce((sum, result) => sum + result.hits, 0);
  const summary = results.map(result => {
    const base = `${foundry.utils.escapeHTML(result.targetName)}: allocation ${result.allocatedStrength}, ${result.attackDice}d6, ${result.hits} hit(s)`;
    if (result.isOrdnance) return base;
    const brace = result.damage.brace;
    const braceSummary = brace?.dice?.length
      ? `, Brace for Impact saves (${brace.dice.length}d6, needing 4+): ${brace.dice.join(", ")}, saved ${brace.saved}, failed ${brace.unsaved}`
      : "";
    return `${base}, shield damage ${result.damage.shieldHits}, hull damage ${result.damage.hullHits}${braceSummary}, remaining shields ${result.damage.after.currentShields}, remaining hull ${result.damage.after.currentHits}`;
  }).join("<br>");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    content: `<div class="bfg-shooting-chat-result"><strong>${foundry.utils.escapeHTML(weapon.name)} split fire</strong><br>${summary}<br>Total hits: ${totalHits}.</div>`
  });
  return { splitFire: true, attackerId, weaponId: weapon.id, weaponName: weapon.name, effectiveStrength: split.effectiveStrength, totalHits, results };
}

export async function commitSplitFire(resolution) {
  if (!resolution?.splitFire || !Array.isArray(resolution.results)) throw new Error("Resolve split fire before applying it.");
  for (const result of resolution.results) {
    const target = canvas.tokens?.get(result.targetId);
    if (!target) throw new Error(`${result.targetName} is no longer on this Scene.`);
    if (result.isOrdnance) {
      const marker = getOrdnanceMarker(target);
      if (!marker || marker.category !== result.ordnanceCategory || (marker.waveId ?? null) !== result.ordnanceWaveId) throw new Error(`${result.targetName}'s ordnance state changed after the roll.`);
    } else if (!sameState(target, { combat: result.damage.before, critical: result.damage.critical.before, catastrophic: result.damage.before.catastrophicState })) {
      throw new Error(`${result.targetName}'s combat state changed after the roll. Resolve split fire again.`);
    }
  }

  const deleteIds = new Set();
  for (const result of resolution.results) {
    const target = canvas.tokens.get(result.targetId);
    if (result.isOrdnance) {
      if (!result.ordnanceHit) continue;
      if (result.ordnanceCategory === "attackCraft") {
        for (const token of canvas.tokens.placeables) {
          const marker = getOrdnanceMarker(token);
          if (marker?.category === "attackCraft" && marker.waveId === result.ordnanceWaveId) deleteIds.add(token.id);
        }
      } else deleteIds.add(target.id);
      continue;
    }
    await setCriticalState(target, result.damage.critical.after);
    if (result.damage.catastrophic) await setCatastrophicState(target, result.damage.catastrophic);
    await setCombatState(target, result.damage.after);
  }
  if (deleteIds.size) await canvas.scene.deleteEmbeddedDocuments("Token", [...deleteIds]);
  return true;
}
