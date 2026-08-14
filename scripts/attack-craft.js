import { MODULE_ID } from "./constants.js";
import { getCombatState, setCombatState } from "./combat-state.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getActingFleetIndex, getTurnState } from "./turn-manager.js";
import { getCriticalState, rollCriticalHits, setCriticalState } from "./critical-hits.js";
import { rollCatastrophicDamage, setCatastrophicState } from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { getOrdnanceMarker, ORDNANCE_MARKER_FLAG } from "./ordnance.js";
import { commitTurretDefenseChoice, getTurretDefenseChoice } from "./ordnance-defense.js";

const HIT_AND_RUN_FLAG = "pendingHitAndRun";

function selectedCrafts() {
  const selected = canvas.tokens?.controlled ?? [];
  if (!selected.length || selected.some(token => getOrdnanceMarker(token)?.category !== "attackCraft")) {
    ui.notifications.warn("Select one or more attack-craft markers, and no other tokens.");
    return [];
  }
  return selected;
}

function selectedTarget() {
  const targets = [...(game.user?.targets ?? [])];
  if (targets.length !== 1) {
    ui.notifications.warn("Use Foundry targeting to select exactly one ship or ordnance marker.");
    return null;
  }
  return targets[0];
}

function rolePriority(token) {
  const role = getOrdnanceMarker(token)?.role;
  return role === "fighter" ? 0 : role === "bomber" ? 1 : 2;
}

async function deleteTokens(tokens) {
  const ids = [...new Set(tokens.filter(Boolean).map(token => token.document.id))];
  if (ids.length) await canvas.scene.deleteEmbeddedDocuments("Token", ids);
}

function validActingCraft(craft, marker) {
  const state = getTurnState();
  if (marker.capShipId) {
    ui.notifications.warn(`${craft.name} is on Combat Air Patrol and cannot resolve independently.`);
    return false;
  }
  if (!state.battleStarted) return game.user?.isGM;
  if (state.phase !== "ordnance") {
    ui.notifications.warn("Attack craft resolve during the Ordnance phase.");
    return false;
  }
  const actingFleet = state.fleets?.[getActingFleetIndex(state)];
  if (actingFleet?.id !== marker.fleetId) {
    ui.notifications.warn(`${craft.name} does not belong to the acting fleet.`);
    return false;
  }
  return true;
}

function armourNumber(value) {
  return Number(String(value ?? "").match(/\d+/)?.[0]);
}

async function applyShieldIgnoringDamage(target, hits) {
  const combat = getCombatState(target);
  const critical = combat.hulk
    ? { after: getCriticalState(target), escortDestroyed: false, extraDamage: 0, results: [] }
    : await rollCriticalHits(target, hits);
  const remainingHull = combat.hulk
    ? 0
    : critical.escortDestroyed
      ? 0
      : Math.max(0, combat.currentHits - hits - critical.extraDamage);
  const catastrophic = (combat.hulk && hits > 0) || (!combat.outOfAction && remainingHull <= 0)
    ? await rollCatastrophicDamage(target)
    : null;
  if (!combat.hulk) await setCriticalState(target, critical.after);
  if (catastrophic) await setCatastrophicState(target, catastrophic);
  await setCombatState(target, { currentHits: remainingHull, currentShields: combat.currentShields });
  return { remainingHull, critical, catastrophic };
}

export async function assignSelectedFighterToCAP() {
  const fighters = selectedCrafts();
  const ship = selectedTarget();
  if (!fighters.length || !ship) return false;
  const markers = fighters.map(getOrdnanceMarker);
  if (markers.some(marker => marker.role !== "fighter")) {
    ui.notifications.warn("Every selected marker must be a fighter to assign Combat Air Patrol.");
    return false;
  }
  if (fighters.some((fighter, index) => !validActingCraft(fighter, markers[index]))) return false;
  const shipFleet = getTokenFleetId(ship);
  if (!getCombatState(ship) || markers.some(marker => shipFleet !== marker.fleetId)) {
    ui.notifications.warn("Target one friendly configured ship for Combat Air Patrol.");
    return false;
  }
  for (const fighter of fighters) {
    await fighter.document.update({
      [`flags.${MODULE_ID}.${ORDNANCE_MARKER_FLAG}.capShipId`]: ship.document.id,
      [`flags.${MODULE_ID}.${ORDNANCE_MARKER_FLAG}.waveId`]: foundry.utils.randomID()
    });
  }
  ui.notifications.info(`${fighters.length} fighter marker(s) are now on Combat Air Patrol around ${ship.name}.`);
  return true;
}

async function resolveAgainstOrdnance(attacker, defender, attackerMarker, defenderMarker) {
  if (attackerMarker.fleetId === defenderMarker.fleetId) {
    ui.notifications.info("Friendly ordnance markers do not attack one another.");
    return false;
  }
  const attackerFighter = attackerMarker.role === "fighter";
  const defenderFighter = defenderMarker.role === "fighter";
  if (attackerFighter || defenderFighter) {
    await deleteTokens([attacker, defender]);
    await ChatMessage.create({ content: `<strong>Ordnance interception:</strong> ${attacker.name} and ${defender.name} are removed.` });
    return true;
  }
  ui.notifications.info("These non-fighter ordnance markers manoeuvre around one another; both remain in play.");
  return true;
}

async function resolveSelectedAgainstShip(selected, target, selectedMarker) {
  const targetCombat = getCombatState(target);
  if (!targetCombat) {
    ui.notifications.warn("Target one configured enemy ship.");
    return false;
  }
  if (getTokenFleetId(target) === selectedMarker.fleetId) {
    if (selectedMarker.role === "fighter") return assignSelectedFighterToCAP();
    ui.notifications.warn("Bombers and assault boats cannot attack a friendly ship.");
    return false;
  }

  let wave = [...selected].sort((a, b) => rolePriority(a) - rolePriority(b));
  const bombersAtStart = wave.filter(token => getOrdnanceMarker(token)?.role === "bomber");
  const assaultAtStart = wave.filter(token => getOrdnanceMarker(token)?.role === "assault-boat");
  if (!bombersAtStart.length && !assaultAtStart.length) {
    ui.notifications.info("Fighters cannot damage ships and remain in play unless assigned to CAP.");
    return true;
  }

  const cap = (canvas.tokens?.placeables ?? []).filter(token => {
    const marker = getOrdnanceMarker(token);
    return marker?.category === "attackCraft" && marker.role === "fighter" && marker.capShipId === target.document.id;
  });
  const intercepted = wave.slice(0, Math.min(cap.length, wave.length));
  await deleteTokens([...cap.slice(0, intercepted.length), ...intercepted]);
  const interceptedIds = new Set(intercepted.map(token => token.document.id));
  wave = wave.filter(token => !interceptedIds.has(token.document.id));

  if (!wave.some(token => ["bomber", "assault-boat"].includes(getOrdnanceMarker(token)?.role))) {
    await deleteTokens(wave);
    ui.notifications.info("CAP fighters intercepted the attacking wave before it reached the ship.");
    return true;
  }

  const turretStrength = Math.max(0, Number(targetCombat.effectiveTurrets) || 0);
  const defenseChoice = getTurretDefenseChoice(target);
  const defensiveTurretDice = defenseChoice === "torpedo" ? 0 : turretStrength;
  if (!defenseChoice && defensiveTurretDice > 0) {
    await commitTurretDefenseChoice(target, "attackCraft");
  }
  const turretRoll = await new Roll(defensiveTurretDice ? `${defensiveTurretDice}d6` : "0").evaluate();
  await publishBFGDice(turretRoll, {
    speaker: ChatMessage.getSpeaker({ token: target.document }),
    flavor: `${target.name}: Turrets defending against attack craft`
  });
  const turretResults = diceFaces(turretRoll);
  const turretKills = turretResults.filter(value => value >= 4).length;
  const turretVictims = wave.slice(0, Math.min(turretKills, wave.length));
  const victimIds = new Set(turretVictims.map(token => token.document.id));
  await deleteTokens(turretVictims);
  const afterTurrets = wave.filter(token => !victimIds.has(token.document.id));
  const survivingBombers = afterTurrets.filter(token => getOrdnanceMarker(token)?.role === "bomber");
  const survivingAssault = afterTurrets.filter(token => getOrdnanceMarker(token)?.role === "assault-boat");
  const suppressionFighters = Math.min(
    wave.filter(token => getOrdnanceMarker(token)?.role === "fighter").length,
    survivingBombers.length
  );

  let bomberAttacks = suppressionFighters;
  const bomberAttackCounts = [];
  for (const bomber of survivingBombers) {
    const runRoll = await new Roll("1d6").evaluate();
    await publishBFGDice(runRoll, {
      speaker: ChatMessage.getSpeaker({ token: bomber.document }),
      flavor: `${bomber.name}: Bomber attack run`
    });
    const attacks = Math.max(0, Number(runRoll.total) - turretStrength);
    bomberAttackCounts.push(attacks);
    bomberAttacks += attacks;
  }

  const targetNumber = Math.min(
    armourNumber(targetCombat.armourFront),
    armourNumber(targetCombat.armourOther)
  );
  const attackRoll = await new Roll(bomberAttacks ? `${bomberAttacks}d6` : "0").evaluate();
  await publishBFGDice(attackRoll, {
    speaker: ChatMessage.getSpeaker({ token: selected[0].document }),
    flavor: `Bomber wave attacking ${target.name}`
  });
  const attackResults = diceFaces(attackRoll);
  const hits = attackResults.filter(value => value >= targetNumber).length;
  const damage = await applyShieldIgnoringDamage(target, hits);

  let pendingHitAndRun = 0;
  if (damage.remainingHull > 0 && survivingAssault.length) {
    const stored = target.document.getFlag(MODULE_ID, HIT_AND_RUN_FLAG) ?? { count: 0 };
    pendingHitAndRun = survivingAssault.length;
    await target.document.setFlag(MODULE_ID, HIT_AND_RUN_FLAG, {
      count: Math.max(0, Number(stored.count) || 0) + pendingHitAndRun,
      source: "assault-boats"
    });
  }

  await deleteTokens(afterTurrets);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: selected[0].document }),
    content: `<div class="bfg-dice-chat-result"><strong>Attack-craft wave against ${foundry.utils.escapeHTML(target.name)}</strong><br>
      CAP interceptions: ${intercepted.length}; turret rolls: ${turretResults.join(", ") || "None"}; turret kills: ${turretVictims.length}<br>
      Surviving bombers: ${survivingBombers.length}; attack runs: ${bomberAttackCounts.join(", ") || "None"}; fighter suppression attacks: ${suppressionFighters}<br>
      Attack dice: ${attackResults.join(", ") || "None"}; Armour: ${targetNumber}+; hits: ${hits}; shields ignored; remaining hull: ${damage.remainingHull}<br>
      Pending assault-boat Hit-and-Run attacks: ${pendingHitAndRun}</div>`
  });
  return true;
}

export async function resolveSelectedAttackCraft() {
  const attackers = selectedCrafts();
  const target = selectedTarget();
  if (!attackers.length || !target) return false;
  const markers = attackers.map(getOrdnanceMarker);
  if (attackers.some((attacker, index) => !validActingCraft(attacker, markers[index]))) return false;
  if (new Set(markers.map(marker => marker.fleetId)).size !== 1) {
    ui.notifications.warn("All selected attack craft must belong to the same fleet.");
    return false;
  }
  const attacker = attackers[0];
  const marker = markers[0];
  const targetMarker = getOrdnanceMarker(target);
  if (targetMarker) {
    const fighter = attackers.find(token => getOrdnanceMarker(token)?.role === "fighter");
    if (fighter) return resolveAgainstOrdnance(fighter, target, getOrdnanceMarker(fighter), targetMarker);
    return resolveAgainstOrdnance(attacker, target, marker, targetMarker);
  }
  return resolveSelectedAgainstShip(attackers, target, marker);
}
