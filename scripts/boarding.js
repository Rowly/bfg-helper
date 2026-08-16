import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getCombatState, setCombatState } from "./combat-state.js";
import { getCriticalState, previewCriticalTableResult, setCriticalState } from "./critical-hits.js";
import { rollCatastrophicDamage, setCatastrophicState } from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { getTurnState } from "./turn-manager.js";
import { openActionResolution } from "./action-resolution-app.js";
import { braceReactionControls, readBraceReactionOptions, resolveBraceReaction, rollBraceSaves } from "./special-orders.js";

export const BOARDING_FLAG = "boardingAction";
export const HIT_AND_RUN_FLAG = "pendingHitAndRun";
const TELEPORT_FLAG = "teleportHitAndRun";

function selectedShip() {
  const selected = canvas.tokens?.controlled ?? [];
  if (selected.length !== 1 || !getCombatState(selected[0])) {
    ui.notifications.warn("Select exactly one configured ship token.");
    return null;
  }
  return selected[0];
}

function selectedTarget() {
  const targets = [...(game.user?.targets ?? [])];
  if (targets.length !== 1 || !getCombatState(targets[0])) {
    ui.notifications.warn("Target exactly one configured ship token.");
    return null;
  }
  return targets[0];
}

function requireGM() {
  if (game.user?.isGM) return true;
  ui.notifications.warn("A Gamemaster must resolve boarding and Hit-and-Run attacks.");
  return false;
}

function activationKey(state = getTurnState()) {
  return `${state.battleId ?? "no-battle"}:${state.round}:${state.activeFleetIndex}`;
}

function pixelsPerCm() {
  const size = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  if (!(size > 0) || !(distance > 0)) throw new Error("The Scene requires a valid grid scale.");
  return size / distance;
}

function distanceCm(first, second) {
  return Math.hypot(Number(second.center.x) - Number(first.center.x), Number(second.center.y) - Number(first.center.y)) / pixelsPerCm();
}

function basesTouch(first, second) {
  const distance = Math.hypot(Number(second.center.x) - Number(first.center.x), Number(second.center.y) - Number(first.center.y));
  const firstRadius = Math.min(Number(first.w), Number(first.h)) / 2;
  const secondRadius = Math.min(Number(second.w), Number(second.h)) / 2;
  return distance <= firstRadius + secondRadius + 2;
}

export function getBoardingState(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  return document?.getFlag?.(MODULE_ID, BOARDING_FLAG) ?? null;
}

export function isBoardingParticipant(tokenOrDocument) {
  return Boolean(getBoardingState(tokenOrDocument)?.partnerId);
}

export function hasDeclaredBoarding(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  const state = getBoardingState(document);
  return Boolean(state?.initiatorId === document?.id);
}

async function setPairState(attacker, defender, extra = {}) {
  const common = {
    initiatorId: attacker.document.id,
    declaredActivation: activationKey(),
    ...extra
  };
  await attacker.document.setFlag(MODULE_ID, BOARDING_FLAG, { ...common, partnerId: defender.document.id });
  await defender.document.setFlag(MODULE_ID, BOARDING_FLAG, { ...common, partnerId: attacker.document.id });
  Hooks.callAll("bfgHelperPendingActionsChanged", attacker.document, defender.document);
}

async function clearPairState(first, second) {
  await first?.document?.unsetFlag(MODULE_ID, BOARDING_FLAG);
  await second?.document?.unsetFlag(MODULE_ID, BOARDING_FLAG);
  Hooks.callAll("bfgHelperPendingActionsChanged", first?.document, second?.document);
}

function boardingErrors(attacker, defender) {
  const state = getTurnState();
  const errors = [];
  if (!state.battleStarted) errors.push("No battle is in progress.");
  if (!["movement", "end"].includes(state.phase)) errors.push("Boarding must be declared during the Movement phase or confirmed in the End Phase.");
  const activeFleet = state.fleets?.[state.activeFleetIndex];
  if (getTokenFleetId(attacker) !== activeFleet?.id) errors.push(`${attacker.name} does not belong to the active fleet.`);
  if (!getTokenFleetId(defender) || getTokenFleetId(attacker) === getTokenFleetId(defender)) errors.push("The target must be an enemy ship.");
  if (!basesTouch(attacker, defender)) errors.push("The ships are not in base contact.");
  if (getCombatState(attacker)?.outOfAction || getCombatState(defender)?.outOfAction) errors.push("Destroyed ships cannot begin boarding actions.");
  if (isBoardingParticipant(attacker) || isBoardingParticipant(defender)) errors.push("One of these ships is already involved in boarding.");
  return errors;
}

export async function declareSelectedShipBoarding() {
  const attacker = selectedShip();
  const defender = selectedTarget();
  if (!attacker || !defender) return false;
  const errors = boardingErrors(attacker, defender);
  if (errors.length) {
    ui.notifications.warn(errors.join(" "));
    return false;
  }
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Confirm Boarding Declaration" },
    content: `<div class="bfg-dialog bfg-action-confirmation">
      <h3>Declare boarding action</h3>
      <div><span>Attacking ship</span><strong>${foundry.utils.escapeHTML(attacker.name)}</strong></div>
      <div><span>Target ship</span><strong>${foundry.utils.escapeHTML(defender.name)}</strong></div>
      <div><span>Base contact</span><strong>Confirmed</strong></div>
      <p>The attacker may not fire weapons or launch ordnance this turn. Ships in an unresolved boarding action cannot be targeted by shooting or attack craft.</p>
    </div>`,
    yes: { label: "Declare Boarding", icon: "fa-solid fa-link" },
    no: { label: "Cancel", icon: "fa-solid fa-xmark" },
    rejectClose: false,
    modal: true
  });
  if (!confirmed) return false;
  await setPairState(attacker, defender, { drawn: false });
  await ChatMessage.create({ content: `<strong>${foundry.utils.escapeHTML(attacker.name)}</strong> has declared a boarding action against <strong>${foundry.utils.escapeHTML(defender.name)}</strong>. The attacker may not shoot or launch ordnance this turn.` });
  return true;
}

function factionBonus(token) {
  const faction = String(getShipData(token)?.faction ?? "").toLowerCase();
  if (faction.includes("chaos") || faction.includes("ork")) return 1;
  if (faction.includes("space marine")) return 2;
  return 0;
}

function ratioBonus(own, enemy) {
  if (!(own > enemy)) return 0;
  if (own >= enemy * 4) return 4;
  if (own >= enemy * 3) return 3;
  if (own >= enemy * 2) return 2;
  return 1;
}

async function rollDice(formula, flavor, token) {
  const roll = await new Roll(formula).evaluate();
  await publishBFGDice(roll, { speaker: ChatMessage.getSpeaker({ token: token.document }), flavor });
  return { total: Number(roll.total ?? 0), results: diceFaces(roll) };
}

function criticalThresholds(difference) {
  if (difference >= 5) return { name: "Overwhelmed", winner: 1, loser: 7 };
  if (difference === 4) return { name: "Stormed", winner: 2, loser: 6 };
  if (difference === 3) return { name: "Driven Back", winner: 3, loser: 6 };
  if (difference === 2) return { name: "Heavy Fighting", winner: 4, loser: 5 };
  return { name: "Stalemate", winner: 5, loser: 5 };
}

function criticalCheckSummary(preview, threshold) {
  if (threshold <= 1) return "Automatic success";
  if (threshold > 6) return "No check";
  const roll = preview.result?.check;
  return `${roll} against ${threshold}+ (${Number(roll) >= threshold ? "passed" : "failed"})`;
}

async function previewBoardingCritical(token, threshold, startingHits, label, source = token) {
  const criticalState = getCriticalState(token);
  if (threshold > 6 || startingHits <= 0) return { finalHits: startingHits, criticalState, result: null, catastrophic: null };
  let check = null;
  if (threshold > 1) {
    check = await rollDice("1d6", `${source.name}: ${label} critical-hit attempt against ${token.name}`, source);
    if (check.total < threshold) return { finalHits: startingHits, criticalState, result: { check: check.total, failed: true }, catastrophic: null };
  }
  const escort = String(getShipData(token)?.stats?.targetClass ?? "capital").toLowerCase() === "escort";
  if (escort) return { finalHits: 0, criticalState, result: { check: check?.total ?? "Automatic", escortDestroyed: true }, catastrophic: await rollCatastrophicDamage(token) };
  const table = await rollDice("2d6", `${source.name}: ${label}, Critical Hits table against ${token.name}`, source);
  const critical = await previewCriticalTableResult(token, table.total, { flavor: label, state: criticalState });
  const finalHits = Math.max(0, startingHits - critical.extraDamage);
  return { finalHits, criticalState: critical.after, result: { check: check?.total ?? "Automatic", critical }, catastrophic: finalHits === 0 ? await rollCatastrophicDamage(token) : null };
}

export async function resolveSelectedBoarding() {
  if (!requireGM()) return false;
  const selected = selectedShip();
  if (!selected) return false;
  const stored = getBoardingState(selected);
  const partner = stored?.partnerId ? canvas.tokens?.get(stored.partnerId) : null;
  if (!partner) {
    ui.notifications.warn(`${selected.name} is not in a valid boarding action.`);
    return false;
  }
  const state = getTurnState();
  if (!state.battleStarted || state.phase !== "end") {
    ui.notifications.warn("Boarding actions resolve during the End Phase.");
    return false;
  }
  const attacker = canvas.tokens.get(stored.initiatorId);
  const defender = attacker?.id === selected.id ? partner : selected;
  if (!attacker || !defender) return false;
  if (getTokenFleetId(attacker) !== state.fleets?.[state.activeFleetIndex]?.id) {
    ui.notifications.warn("This boarding action does not belong to the active fleet's End Phase.");
    return false;
  }

  const options = await foundry.applications.api.DialogV2.input({
    window: { title: `Boarding: ${attacker.name} against ${defender.name}` },
    content: `<div class="bfg-dialog">
      <p>Boarding values use remaining hull; the defender also adds remaining turrets.</p>
      <label><input type="checkbox" name="attackerBlast"> ${attacker.name} has Blast Markers in base contact</label>
      <label><input type="checkbox" name="defenderBlast"> ${defender.name} has Blast Markers in base contact</label>
      <label>${attacker.name} additional modifier</label><input type="number" name="attackerExtra" value="0" step="1">
      <label>${defender.name} additional modifier</label><input type="number" name="defenderExtra" value="0" step="1">
    </div>`,
    ok: { label: "Resolve Boarding", icon: "fa-solid fa-dice-d6" }, rejectClose: false, modal: true
  });
  if (!options) return false;

  const attackerCombat = getCombatState(attacker);
  const defenderCombat = getCombatState(defender);
  const attackerValue = attackerCombat.crippled ? Math.ceil(attackerCombat.currentHits / 2) : attackerCombat.currentHits;
  const defenderHullValue = defenderCombat.crippled ? Math.ceil(defenderCombat.currentHits / 2) : defenderCombat.currentHits;
  const defenderValue = defenderHullValue + defenderCombat.effectiveTurrets;
  const attackerModifier = ratioBonus(attackerValue, defenderValue) + (options.defenderBlast ? 1 : 0) + (defenderCombat.crippled ? 2 : 0) + factionBonus(attacker) + Number(options.attackerExtra ?? 0);
  const defenderModifier = ratioBonus(defenderValue, attackerValue) + (options.attackerBlast ? 1 : 0) + (attackerCombat.crippled ? 2 : 0) + factionBonus(defender) + Number(options.defenderExtra ?? 0);
  return openActionResolution({
    heading: "Boarding action",
    rollLabel: "Roll boarding action",
    applyLabel: "Apply boarding result",
    detailsHtml: `<div class="bfg-action-confirmation"><div><span>${attacker.name} boarding value</span><strong>${attackerValue}</strong></div><div><span>${attacker.name} modifier</span><strong>+${attackerModifier}</strong></div><div><span>${attacker.name} boarding dice</span><strong>1d6</strong></div><div><span>${defender.name} boarding value</span><strong>${defenderValue}</strong></div><div><span>${defender.name} modifier</span><strong>+${defenderModifier}</strong></div><div><span>${defender.name} boarding dice</span><strong>1d6</strong></div></div><p>The score difference becomes hull damage to the loser; boarding-specific critical checks then follow.</p>`,
    roll: async () => {
      const attackerRoll = await rollDice("1d6", `${attacker.name}: Boarding action`, attacker);
      const defenderRoll = await rollDice("1d6", `${defender.name}: Boarding defence`, defender);
      const attackerScore = attackerRoll.total + attackerModifier;
      const defenderScore = defenderRoll.total + defenderModifier;
      if (attackerScore === defenderScore) return { draw: true, attackerRoll, defenderRoll, attackerScore, defenderScore, resultHtml: `<h3>Drawn combat</h3><div class="bfg-action-confirmation"><div><span>${attacker.name} boarding die (1d6)</span><strong>${attackerRoll.total} + ${attackerModifier} = ${attackerScore}</strong></div><div><span>${defender.name} boarding die (1d6)</span><strong>${defenderRoll.total} + ${defenderModifier} = ${defenderScore}</strong></div></div><p>The ships will remain grappled after this result is applied.</p>` };
      const winner = attackerScore > defenderScore ? attacker : defender;
      const loser = winner.id === attacker.id ? defender : attacker;
      const difference = Math.abs(attackerScore - defenderScore);
      const loserStart = loser.id === attacker.id ? attackerCombat.currentHits : defenderCombat.currentHits;
      const loserAfterDamage = Math.max(0, loserStart - difference);
      const thresholds = criticalThresholds(difference);
      const winnerStart = winner.id === attacker.id ? attackerCombat.currentHits : defenderCombat.currentHits;
      const winnerCritical = await previewBoardingCritical(loser, thresholds.winner, loserAfterDamage, "Boarding action", winner);
      const loserCritical = await previewBoardingCritical(winner, thresholds.loser, winnerStart, "Boarding action", loser);
      return { draw: false, attackerRoll, defenderRoll, attackerScore, defenderScore, winnerId: winner.id, loserId: loser.id, difference, loserAfterDamage, winnerCritical, loserCritical,
        resultName: thresholds.name,
        winnerThreshold: thresholds.winner,
        loserThreshold: thresholds.loser,
        resultHtml: `<h3>${thresholds.name}</h3><div class="bfg-action-confirmation"><div><span>${attacker.name} boarding die (1d6)</span><strong>${attackerRoll.total} + ${attackerModifier} = ${attackerScore}</strong></div><div><span>${defender.name} boarding die (1d6)</span><strong>${defenderRoll.total} + ${defenderModifier} = ${defenderScore}</strong></div><div><span>Winner</span><strong>${foundry.utils.escapeHTML(winner.name)}</strong></div><div><span>Loser</span><strong>${foundry.utils.escapeHTML(loser.name)}</strong></div><div><span>Hull damage</span><strong>${difference} to ${foundry.utils.escapeHTML(loser.name)}</strong></div><div><span>${foundry.utils.escapeHTML(winner.name)} scores a critical on</span><strong>${thresholds.winner <= 1 ? "Automatic" : `${thresholds.winner}+`}</strong></div><div><span>Critical attempt against ${foundry.utils.escapeHTML(loser.name)}</span><strong>${criticalCheckSummary(winnerCritical, thresholds.winner)}</strong></div><div><span>Effect on ${foundry.utils.escapeHTML(loser.name)}</span><strong>${winnerCritical.result?.critical?.name ?? (winnerCritical.result?.escortDestroyed ? "Escort destroyed" : "None")}</strong></div><div><span>${foundry.utils.escapeHTML(loser.name)} scores a critical on</span><strong>${thresholds.loser > 6 ? "None" : `${thresholds.loser}+`}</strong></div><div><span>Critical attempt against ${foundry.utils.escapeHTML(winner.name)}</span><strong>${criticalCheckSummary(loserCritical, thresholds.loser)}</strong></div><div><span>Effect on ${foundry.utils.escapeHTML(winner.name)}</span><strong>${loserCritical.result?.critical?.name ?? (loserCritical.result?.escortDestroyed ? "Escort destroyed" : "None")}</strong></div><div><span>Critical-table dice</span><strong>2d6 for each successful critical attempt</strong></div><div><span>${foundry.utils.escapeHTML(loser.name)} remaining hull</span><strong>${winnerCritical.finalHits}</strong></div><div><span>${foundry.utils.escapeHTML(winner.name)} remaining hull</span><strong>${loserCritical.finalHits}</strong></div></div>` };
    },
    apply: async outcome => {
      const currentAttacker = getCombatState(attacker), currentDefender = getCombatState(defender);
      if (currentAttacker.currentHits !== attackerCombat.currentHits || currentDefender.currentHits !== defenderCombat.currentHits) throw new Error("A boarding participant changed after the roll. Resolve the action again.");
      if (outcome.draw) {
        await setPairState(attacker, defender, { drawn: true });
        await ChatMessage.create({ content: `<strong>Boarding draw:</strong> ${attacker.name} and ${defender.name} remain grappled. Neither may move, shoot, or launch ordnance.` });
        return;
      }
      const winner = canvas.tokens.get(outcome.winnerId), loser = canvas.tokens.get(outcome.loserId);
      const winnerCombat = winner.id === attacker.id ? attackerCombat : defenderCombat;
      const loserCombat = loser.id === attacker.id ? attackerCombat : defenderCombat;
      await setCriticalState(winner, outcome.loserCritical.criticalState);
      await setCriticalState(loser, outcome.winnerCritical.criticalState);
      await setCombatState(winner, { currentHits: outcome.loserCritical.finalHits, currentShields: winnerCombat.currentShields });
      await setCombatState(loser, { currentHits: outcome.winnerCritical.finalHits, currentShields: loserCombat.currentShields });
      if (outcome.loserCritical.catastrophic) await setCatastrophicState(winner, outcome.loserCritical.catastrophic);
      if (outcome.winnerCritical.catastrophic) await setCatastrophicState(loser, outcome.winnerCritical.catastrophic);
      else if (outcome.loserAfterDamage === 0) await setCatastrophicState(loser, { type: "drifting-hulk", name: "Drifting Hulk", blastMarkers: 1, futureMovement: "4d6 cm forward in each subsequent Movement phase", instruction: "Place 1 Blast Marker in contact with the hulk after each move." });
      await clearPairState(attacker, defender);
      await ChatMessage.create({ content: `<div><strong>${foundry.utils.escapeHTML(outcome.resultName)}: ${foundry.utils.escapeHTML(winner.name)} wins the boarding action</strong><br>Scores: ${foundry.utils.escapeHTML(attacker.name)} ${outcome.attackerScore}, ${foundry.utils.escapeHTML(defender.name)} ${outcome.defenderScore}.<br>${foundry.utils.escapeHTML(loser.name)} suffers ${outcome.difference} hull damage and has ${outcome.winnerCritical.finalHits} hull remaining.<br>${foundry.utils.escapeHTML(winner.name)} scores a critical against ${foundry.utils.escapeHTML(loser.name)} on ${outcome.winnerThreshold <= 1 ? "an automatic success" : `${outcome.winnerThreshold}+`}: ${criticalCheckSummary(outcome.winnerCritical, outcome.winnerThreshold)}. Effect: ${foundry.utils.escapeHTML(outcome.winnerCritical.result?.critical?.name ?? (outcome.winnerCritical.result?.escortDestroyed ? "Escort destroyed" : "None"))}.<br>${foundry.utils.escapeHTML(loser.name)} scores a critical against ${foundry.utils.escapeHTML(winner.name)} on ${outcome.loserThreshold > 6 ? "no result" : `${outcome.loserThreshold}+`}: ${criticalCheckSummary(outcome.loserCritical, outcome.loserThreshold)}. Effect: ${foundry.utils.escapeHTML(outcome.loserCritical.result?.critical?.name ?? (outcome.loserCritical.result?.escortDestroyed ? "Escort destroyed" : "None"))}.</div>` });
    }
  });
}

async function rollHitAndRunOutcome(target, count, source) {
  const beforeCombat = getCombatState(target);
  let remainingHull = beforeCombat.currentHits;
  let criticalState = getCriticalState(target);
  let catastrophic = null;
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const roll = await rollDice("1d6", `${target.name}: ${source} Hit-and-Run / Critical Hits table die`, target);
    if (roll.total > 1) {
      const brace = await rollBraceSaves(target, 1, "Brace save against Hit-and-Run");
      if (brace.saved) {
        results.push({ roll: roll.total, saved: true, brace });
        continue;
      }
    }
    const escort = String(getShipData(target)?.stats?.targetClass ?? "capital").toLowerCase() === "escort";
    if (escort && roll.total >= 4) {
      remainingHull = 0;
      catastrophic = await rollCatastrophicDamage(target);
      results.push({ roll: roll.total, escortDestroyed: true });
      break;
    }
    if (roll.total === 1) results.push({ roll: 1, failed: true });
    else {
      const critical = await previewCriticalTableResult(target, roll.total, { flavor: `${source} Hit-and-Run`, state: criticalState });
      criticalState = critical.after;
      remainingHull = Math.max(0, remainingHull - critical.extraDamage);
      results.push({ roll: roll.total, critical });
      if (remainingHull === 0) {
        catastrophic = await rollCatastrophicDamage(target);
        break;
      }
    }
  }
  return { beforeCombat, remainingHull, criticalState, catastrophic, results };
}

export async function resolveSelectedPendingHitAndRun() {
  if (!requireGM()) return false;
  const target = selectedShip();
  if (!target) return false;
  const state = getTurnState();
  if (!state.battleStarted || state.phase !== "end") {
    ui.notifications.warn("Pending Hit-and-Run attacks resolve during the End Phase.");
    return false;
  }
  const pending = target.document.getFlag(MODULE_ID, HIT_AND_RUN_FLAG) ?? {};
  const count = Math.max(0, Math.trunc(Number(pending.count)));
  if (!count) {
    ui.notifications.info(`${target.name} has no pending Hit-and-Run attacks.`);
    return false;
  }
  return openActionResolution({
    heading: "Hit-and-Run attacks",
    rollLabel: "Roll Hit-and-Run attacks",
    applyLabel: "Apply critical effects",
    detailsHtml: `<div class="bfg-dialog bfg-action-confirmation">
      <h3>Assault-boat Hit-and-Run attacks</h3>
      <div><span>Target</span><strong>${foundry.utils.escapeHTML(target.name)}</strong></div>
      <div><span>Hit-and-Run / Critical Hits table dice</span><strong>${count}d6</strong></div>
      <div><span>Current hull</span><strong>${getCombatState(target).currentHits}/${getCombatState(target).maximumHits}</strong></div>
      <p>Each attack rolls 1D6. A 1 fails; other results apply the corresponding Critical Hits table effect. Escorts are destroyed on a roll of 4+.</p>
      ${braceReactionControls(target)}
    </div>`,
    readOptions: element => readBraceReactionOptions(element),
    roll: async options => {
      await resolveBraceReaction(target, options);
      const outcome = await rollHitAndRunOutcome(target, count, "Assault boat");
      return { ...outcome, resultHtml: `<h3>Hit-and-Run result</h3><div class="bfg-action-confirmation"><div><span>Hit-and-Run dice (${count}d6, needing 2+)</span><strong>${outcome.results.map(result => result.roll).join(", ")}</strong></div><div><span>Effects</span><strong>${outcome.results.map(result => result.saved ? "Saved by Brace for Impact" : result.escortDestroyed ? "Escort destroyed" : result.failed ? "Failed" : result.critical.name).join("; ")}</strong></div><div><span>Remaining hull</span><strong>${outcome.remainingHull}</strong></div></div><p>Review these critical effects before applying them.</p>` };
    },
    apply: async outcome => {
      const current = getCombatState(target);
      if (current.currentHits !== outcome.beforeCombat.currentHits || current.currentShields !== outcome.beforeCombat.currentShields) throw new Error("The target changed after the roll. Resolve the attacks again.");
      await setCriticalState(target, outcome.criticalState);
      if (outcome.catastrophic) await setCatastrophicState(target, outcome.catastrophic);
      await setCombatState(target, { currentHits: outcome.remainingHull, currentShields: current.currentShields });
      await target.document.unsetFlag(MODULE_ID, HIT_AND_RUN_FLAG);
      Hooks.callAll("bfgHelperPendingActionsChanged", target.document);
      await ChatMessage.create({ content: `<strong>${target.name}: ${count} Hit-and-Run attack(s)</strong><br>${outcome.results.map(result => result.saved ? `${result.roll}: saved by Brace for Impact` : result.escortDestroyed ? `${result.roll}: escort destroyed` : result.failed ? "1: failed" : `${result.roll}: ${result.critical.name}`).join("; ")}` });
    }
  });
}

export async function resolveSelectedTeleportHitAndRun() {
  if (!requireGM()) return false;
  const attacker = selectedShip();
  const target = selectedTarget();
  if (!attacker || !target) return false;
  const state = getTurnState();
  const attackerCombat = getCombatState(attacker);
  const targetCombat = getCombatState(target);
  const errors = [];
  if (!state.battleStarted || state.phase !== "end") errors.push("Teleport attacks resolve during the End Phase.");
  if (getTokenFleetId(attacker) !== state.fleets?.[state.activeFleetIndex]?.id) errors.push("The attacker does not belong to the active fleet.");
  if (getTokenFleetId(attacker) === getTokenFleetId(target)) errors.push("The target must be an enemy ship.");
  if (String(getShipData(attacker)?.stats?.targetClass ?? "capital").toLowerCase() === "escort") errors.push("Escorts cannot make teleport attacks.");
  if (attackerCombat.crippled) errors.push("Crippled ships cannot make teleport attacks.");
  if (targetCombat.currentShields > 0) errors.push("The target still has active shields.");
  if (targetCombat.currentHits > attackerCombat.currentHits) errors.push("The target has more remaining hull than the attacker.");
  if (distanceCm(attacker, target) > 10.000001) errors.push("The target is more than 10 cm away.");
  if (attacker.document.getFlag(MODULE_ID, TELEPORT_FLAG)?.activation === activationKey(state)) errors.push("This ship has already made a teleport attack this turn.");
  if (errors.length) {
    ui.notifications.warn(errors.join(" "));
    return false;
  }
  return openActionResolution({
    heading: "Teleport Hit-and-Run",
    rollLabel: "Roll teleport attack",
    applyLabel: "Apply critical effect",
    detailsHtml: `<div class="bfg-dialog bfg-action-confirmation">
      <h3>Teleport attack</h3>
      <div><span>Attacking ship</span><strong>${foundry.utils.escapeHTML(attacker.name)}</strong></div>
      <div><span>Target ship</span><strong>${foundry.utils.escapeHTML(target.name)}</strong></div>
      <div><span>Range</span><strong>${distanceCm(attacker, target).toFixed(1)} cm</strong></div>
      <div><span>Target shields</span><strong>${targetCombat.currentShields}</strong></div>
      <div><span>Hit-and-Run / Critical Hits table die</span><strong>1d6</strong></div>
      <p>This is a single roll. A 1 fails. A result from 2 to 6 succeeds and that same die result is used on the Critical Hits table. An escort is destroyed on a roll of 4+.</p>
      <p>Special-order eligibility is not yet automated and must be confirmed by the players.</p>
      ${braceReactionControls(target)}
    </div>`,
    readOptions: element => readBraceReactionOptions(element),
    roll: async options => {
      await resolveBraceReaction(target, options);
      const outcome = await rollHitAndRunOutcome(target, 1, `Teleport attack from ${attacker.name}`);
      const result = outcome.results[0];
      return { ...outcome, resultHtml: `<h3>Teleport attack result</h3><div class="bfg-action-confirmation"><div><span>Hit-and-Run / Critical Hits table die (1d6)</span><strong>${result.roll}</strong></div><div><span>Attack</span><strong>${result.failed ? "Failed" : "Successful"}</strong></div><div><span>Critical result</span><strong>${result.saved ? "Saved by Brace for Impact" : result.failed ? "None" : result.escortDestroyed ? "Escort destroyed" : result.critical.name}</strong></div><div><span>Remaining hull</span><strong>${outcome.remainingHull}</strong></div></div><p>The displayed D6 determined both whether the attack succeeded and its Critical Hits table result.</p>` };
    },
    apply: async outcome => {
      const current = getCombatState(target);
      if (current.currentHits !== outcome.beforeCombat.currentHits || current.currentShields !== outcome.beforeCombat.currentShields) throw new Error("The target changed after the roll. Resolve the attack again.");
      await setCriticalState(target, outcome.criticalState);
      if (outcome.catastrophic) await setCatastrophicState(target, outcome.catastrophic);
      await setCombatState(target, { currentHits: outcome.remainingHull, currentShields: current.currentShields });
      await attacker.document.setFlag(MODULE_ID, TELEPORT_FLAG, { activation: activationKey(state), targetId: target.document.id });
      const result = outcome.results[0];
      await ChatMessage.create({ content: `<strong>${attacker.name} teleports troops onto ${target.name}</strong><br>Hit-and-Run / Critical Hits table die: ${result.roll}.<br>${result.saved ? "Attack: Successful. Critical result saved by Brace for Impact." : result.failed ? "Attack: Failed. Critical result: None." : result.escortDestroyed ? "Attack: Successful. Critical result: Escort destroyed." : `Attack: Successful. Critical result: ${result.critical.name}.`}` });
    }
  });
}

export async function resetBoardingState() {
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.document.getFlag(MODULE_ID, BOARDING_FLAG) !== undefined) await token.document.unsetFlag(MODULE_ID, BOARDING_FLAG);
    if (token.document.getFlag(MODULE_ID, TELEPORT_FLAG) !== undefined) await token.document.unsetFlag(MODULE_ID, TELEPORT_FLAG);
  }
  Hooks.callAll("bfgHelperPendingActionsChanged");
}
