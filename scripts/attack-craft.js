import { MODULE_ID } from "./constants.js";
import { getCombatState, setCombatState } from "./combat-state.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getActingFleetIndex, getTurnState } from "./turn-manager.js";
import { getCriticalState, rollCriticalHits, setCriticalState } from "./critical-hits.js";
import { rollCatastrophicDamage, setCatastrophicState } from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { getOrdnanceMarker, ORDNANCE_MARKER_FLAG } from "./ordnance.js";
import { commitTurretDefenseChoice, getTurretDefenseChoice } from "./ordnance-defense.js";
import { isBoardingParticipant } from "./boarding.js";
import { openActionResolution } from "./action-resolution-app.js";

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

function attackWaveName(markers) {
  const roles = new Set(markers.map(marker => marker?.role).filter(role => role !== "fighter"));
  if (roles.size === 1 && roles.has("assault-boat")) return "Boarding-craft wave";
  if (roles.size === 1 && roles.has("bomber")) return "Bomber wave";
  return "Mixed attack-craft wave";
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

function attackCraftDetails(attackers, target, markers, targetMarker) {
  const roles = markers.reduce((counts, marker) => {
    const label = marker.role === "assault-boat" ? "Assault boats" : marker.role === "bomber" ? "Bombers" : "Fighters";
    counts[label] = (counts[label] ?? 0) + 1;
    return counts;
  }, {});
  const targetCombat = getCombatState(target);
  const targetType = targetMarker
    ? `${targetMarker.name ?? target.name} (${targetMarker.category})`
    : `${target.name} (ship)`;
  return `<div class="bfg-dialog bfg-action-confirmation">
      <h3>Attack craft resolution</h3>
      <div><span>Selected attackers</span><strong>${attackers.length}</strong></div>
      <div><span>Composition</span><strong>${foundry.utils.escapeHTML(Object.entries(roles).map(([role, count]) => `${role}: ${count}`).join(", "))}</strong></div>
      <div><span>Target</span><strong>${foundry.utils.escapeHTML(targetType)}</strong></div>
      ${targetCombat ? `<div><span>Target hull</span><strong>${targetCombat.currentHits}/${targetCombat.maximumHits}</strong></div><div><span>Turret dice</span><strong>Up to ${targetCombat.effectiveTurrets}d6, needing 4+</strong></div><div><span>Bomber attack-run dice</span><strong>1d6 per surviving bomber</strong></div><div><span>Attack dice</span><strong>Determined by attack-run results</strong></div><div><span>Critical checks</span><strong>1d6 per hit, needing 6</strong></div><p>Attack-craft damage ignores shields. Turret fire and any CAP interception will resolve first.</p>` : `<p>Ordnance interactions resolve marker against marker. Fighters remove the opposing marker and are also removed.</p>`}
      <p>No dice, damage, or token removal occurs until this action is confirmed.</p>
    </div>`;
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
  const removed = attackerFighter || defenderFighter;
  return openActionResolution({
    heading: "Ordnance interaction",
    rollLabel: "Resolve interaction",
    applyLabel: "Apply ordnance result",
    detailsHtml: attackCraftDetails([attacker], defender, [attackerMarker], defenderMarker),
    roll: async () => ({ removed, resultHtml: `<h3>Interaction result</h3><p>${removed ? `${foundry.utils.escapeHTML(attacker.name)} and ${foundry.utils.escapeHTML(defender.name)} will both be removed.` : "These non-fighter markers manoeuvre around one another and remain in play."}</p>` }),
    apply: async outcome => {
      if (outcome.removed) await deleteTokens([attacker, defender]);
      await ChatMessage.create({ content: outcome.removed ? `<strong>Ordnance interception:</strong> ${attacker.name} and ${defender.name} are removed.` : "<strong>Ordnance interaction:</strong> Both non-fighter markers remain in play." });
    }
  });
}

async function resolveSelectedAgainstShip(selected, target, selectedMarker) {
  if (isBoardingParticipant(target)) {
    ui.notifications.warn(`${target.name} is involved in a boarding action and cannot be attacked by attack craft.`);
    return false;
  }
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
  const waveName = attackWaveName(selected.map(getOrdnanceMarker));
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
  const turretStrength = Math.max(0, Number(targetCombat.effectiveTurrets) || 0);
  const defenseChoice = getTurretDefenseChoice(target);
  const defensiveTurretDice = defenseChoice === "torpedo" ? 0 : turretStrength;
  const targetNumber = Math.min(
    armourNumber(targetCombat.armourFront),
    armourNumber(targetCombat.armourOther)
  );
  return openActionResolution({
    heading: "Attack-craft attack",
    rollLabel: "Roll attack-craft attack",
    applyLabel: "Apply damage and remove craft",
    detailsHtml: attackCraftDetails(selected, target, selected.map(getOrdnanceMarker), null),
    roll: async () => {
      const currentWave = [...wave];
      const intercepted = currentWave.slice(0, Math.min(cap.length, currentWave.length));
      const interceptedIds = new Set(intercepted.map(token => token.document.id));
      const afterCAP = currentWave.filter(token => !interceptedIds.has(token.document.id));
      let turretResults = [], turretVictims = [], afterTurrets = afterCAP;
      if (afterCAP.some(token => ["bomber", "assault-boat"].includes(getOrdnanceMarker(token)?.role))) {
        const turretRoll = await new Roll(defensiveTurretDice ? `${defensiveTurretDice}d6` : "0").evaluate();
        await publishBFGDice(turretRoll, { speaker: ChatMessage.getSpeaker({ token: target.document }), flavor: `${target.name}: Turrets defending against attack craft` });
        turretResults = diceFaces(turretRoll);
        const turretKills = turretResults.filter(value => value >= 4).length;
        turretVictims = afterCAP.slice(0, Math.min(turretKills, afterCAP.length));
        const victimIds = new Set(turretVictims.map(token => token.document.id));
        afterTurrets = afterCAP.filter(token => !victimIds.has(token.document.id));
      }
      const survivingBombers = afterTurrets.filter(token => getOrdnanceMarker(token)?.role === "bomber");
      const survivingAssault = afterTurrets.filter(token => getOrdnanceMarker(token)?.role === "assault-boat");
      const suppressionFighters = Math.min(afterCAP.filter(token => getOrdnanceMarker(token)?.role === "fighter").length, survivingBombers.length);
      let bomberAttacks = suppressionFighters;
      const bomberAttackCounts = [];
      const bomberRunRolls = [];
      for (const bomber of survivingBombers) {
        const runRoll = await new Roll("1d6").evaluate();
        await publishBFGDice(runRoll, { speaker: ChatMessage.getSpeaker({ token: bomber.document }), flavor: `${bomber.name}: Bomber attack run` });
        const attacks = Math.max(0, Number(runRoll.total) - turretStrength);
        bomberRunRolls.push(Number(runRoll.total));
        bomberAttackCounts.push(attacks);
        bomberAttacks += attacks;
      }
      let attackResults = [];
      if (bomberAttacks > 0) {
        const attackRoll = await new Roll(`${bomberAttacks}d6`).evaluate();
        await publishBFGDice(attackRoll, { speaker: ChatMessage.getSpeaker({ token: selected[0].document }), flavor: `Bomber attack dice against ${target.name}` });
        attackResults = diceFaces(attackRoll);
      }
      const hits = attackResults.filter(value => value >= targetNumber).length;
      const critical = targetCombat.hulk ? { after: getCriticalState(target), escortDestroyed: false, extraDamage: 0, results: [] } : await rollCriticalHits(target, hits);
      const remainingHull = targetCombat.hulk ? 0 : critical.escortDestroyed ? 0 : Math.max(0, targetCombat.currentHits - hits - critical.extraDamage);
      const catastrophic = (targetCombat.hulk && hits > 0) || (!targetCombat.outOfAction && remainingHull <= 0) ? await rollCatastrophicDamage(target) : null;
      const pendingHitAndRun = remainingHull > 0 ? survivingAssault.length : 0;
      const criticalChecks = critical.checkResults?.join(", ") || "None";
      const criticalEffects = critical.escortDestroyed ? "Escort destroyed" : critical.results?.map(result => `${result.name}${result.shifted ? ` (table result ${result.appliedTotal})` : ""}${result.extraDamage ? ` (+${result.extraDamage} damage)` : ""}`).join("; ") || "None";
      const catastrophicResult = catastrophic ? `${catastrophic.name}${catastrophic.tableTotal ? ` (${catastrophic.tableTotal})` : ""}` : "None";
      return { intercepted, turretResults, turretVictims, afterTurrets, survivingBombers, survivingAssault, suppressionFighters, bomberRunRolls, bomberAttackCounts, bomberAttacks, attackResults, hits, critical, catastrophic, remainingHull, pendingHitAndRun, defenseChoice, defensiveTurretDice,
        criticalChecks, criticalEffects, catastrophicResult,
        resultHtml: `<h3>${waveName} result</h3><div class="bfg-action-confirmation"><div><span>CAP interceptions</span><strong>${intercepted.length}</strong></div><div><span>Turret dice (${defensiveTurretDice}d6, needing 4+)</span><strong>${turretResults.join(", ") || "None"}</strong></div><div><span>Turret kills</span><strong>${turretVictims.length}</strong></div><div><span>Surviving bombers</span><strong>${survivingBombers.length}</strong></div><div><span>Surviving boarding craft</span><strong>${survivingAssault.length}</strong></div><div><span>Bomber attack-run dice (${survivingBombers.length}d6)</span><strong>${bomberRunRolls.join(", ") || "None"}</strong></div><div><span>Bomber attacks generated</span><strong>${bomberAttackCounts.join(", ") || "None"}; total ${bomberAttacks}</strong></div><div><span>Bomber attack dice (${bomberAttacks}d6, needing ${targetNumber}+)</span><strong>${attackResults.join(", ") || "None"}</strong></div><div><span>Hits</span><strong>${hits}</strong></div><div><span>Critical checks (${hits}d6, needing 6)</span><strong>${criticalChecks}</strong></div><div><span>Critical effects</span><strong>${foundry.utils.escapeHTML(criticalEffects)}</strong></div><div><span>Critical damage</span><strong>${critical.extraDamage ?? 0}</strong></div><div><span>Catastrophic result</span><strong>${foundry.utils.escapeHTML(catastrophicResult)}</strong></div><div><span>Remaining hull</span><strong>${remainingHull}</strong></div><div><span>Pending boarding-craft Hit-and-Run attacks</span><strong>${pendingHitAndRun}</strong></div></div><p>Shields are ignored. Review all damage and marker losses before applying.</p>` };
    },
    apply: async outcome => {
      const current = getCombatState(target);
      if (!current || current.currentHits !== targetCombat.currentHits || current.currentShields !== targetCombat.currentShields) throw new Error("The target changed after the roll. Resolve the attack again.");
      if (!outcome.defenseChoice && outcome.defensiveTurretDice > 0) await commitTurretDefenseChoice(target, "attackCraft");
      await deleteTokens([...cap.slice(0, outcome.intercepted.length), ...outcome.intercepted, ...outcome.turretVictims, ...outcome.afterTurrets]);
      if (!targetCombat.hulk) await setCriticalState(target, outcome.critical.after);
      if (outcome.catastrophic) await setCatastrophicState(target, outcome.catastrophic);
      await setCombatState(target, { currentHits: outcome.remainingHull, currentShields: targetCombat.currentShields });
      if (outcome.pendingHitAndRun > 0) {
        const stored = target.document.getFlag(MODULE_ID, HIT_AND_RUN_FLAG) ?? { count: 0 };
        await target.document.setFlag(MODULE_ID, HIT_AND_RUN_FLAG, { count: Math.max(0, Number(stored.count) || 0) + outcome.pendingHitAndRun, source: "assault-boats" });
        Hooks.callAll("bfgHelperPendingActionsChanged", target.document);
      }
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ token: selected[0].document }), content: `<div class="bfg-dice-chat-result"><strong>${waveName} against ${foundry.utils.escapeHTML(target.name)}</strong><br>CAP interceptions: ${outcome.intercepted.length}; turret rolls: ${outcome.turretResults.join(", ") || "None"}; turret kills: ${outcome.turretVictims.length}<br>Surviving bombers: ${outcome.survivingBombers.length}; surviving boarding craft: ${outcome.survivingAssault.length}; fighter suppression attacks: ${outcome.suppressionFighters}<br>Bomber attack runs: ${outcome.bomberAttackCounts.join(", ") || "None"}; bomber attack dice: ${outcome.attackResults.join(", ") || "None"}; Armour: ${targetNumber}+; hits: ${outcome.hits}; shields ignored<br>Critical checks: ${outcome.criticalChecks}; critical effects: ${foundry.utils.escapeHTML(outcome.criticalEffects)}; critical damage: ${outcome.critical.extraDamage ?? 0}<br>Catastrophic result: ${foundry.utils.escapeHTML(outcome.catastrophicResult)}; remaining hull: ${outcome.remainingHull}<br>Pending boarding-craft Hit-and-Run attacks: ${outcome.pendingHitAndRun}</div>` });
    }
  });
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
