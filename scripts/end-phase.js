import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { canUserControlActingFleet, requireUserCanControlToken } from "./fleet-control.js";
import { getCombatState, setCombatState } from "./combat-state.js";
import { CRITICAL_RESULTS, criticalCount, getCriticalState, setCriticalState } from "./critical-hits.js";
import { rollCatastrophicDamage, setCatastrophicState } from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { getTurnState } from "./turn-manager.js";
import { openActionResolution } from "./action-resolution-app.js";

export const DAMAGE_CONTROL_FLAG = "damageControl";
export const BLAST_REMOVAL_FLAG = "blastMarkerRemoval";

function requireGM() {
  if (canUserControlActingFleet()) return true;
  ui.notifications.warn("Only the active fleet's assigned player or a Gamemaster can resolve End Phase actions.");
  return false;
}

function endPhaseActivationKey(state = getTurnState()) {
  return `${state.battleId ?? "no-battle"}:${state.round}:${state.activeFleetIndex}:end`;
}

/** Ships with repairable critical damage whose Damage Control has not been resolved. */
export function unresolvedRepairableDamageShips(state = getTurnState()) {
  if (!state.battleStarted || state.phase !== "end") return [];
  const activeFleetId = state.fleets?.[state.activeFleetIndex]?.id;
  const activation = endPhaseActivationKey(state);
  return (canvas.tokens?.placeables ?? []).filter(token => {
    const combat = getCombatState(token);
    const criticalState = getCriticalState(token);
    const hasRepairableDamage = Object.values(CRITICAL_RESULTS)
      .some(result => result.repairable && criticalCount(criticalState, result.id) > 0);
    return getTokenFleetId(token) === activeFleetId
      && combat
      && !combat.outOfAction
      && hasRepairableDamage
      && token.document.getFlag(MODULE_ID, DAMAGE_CONTROL_FLAG)?.activation !== activation;
  });
}

export const unresolvedFireDamageShips = unresolvedRepairableDamageShips;

export function blastMarkerRemovalResolved(state = getTurnState()) {
  if (!state.battleStarted || state.phase !== "end" || !canvas.scene) return false;
  return canvas.scene.getFlag(MODULE_ID, BLAST_REMOVAL_FLAG)?.activation === endPhaseActivationKey(state);
}

function selectedShip() {
  const selected = canvas.tokens?.controlled ?? [];
  if (selected.length !== 1 || !getCombatState(selected[0])) {
    ui.notifications.warn("Select exactly one configured ship token.");
    return null;
  }
  return selected[0];
}

function activeEndPhaseErrors(token, state) {
  const errors = [];
  if (!state.battleStarted || state.phase !== "end") errors.push("This action is only available during the End Phase.");
  const activeFleet = state.fleets?.[state.activeFleetIndex];
  if (getTokenFleetId(token) !== activeFleet?.id) errors.push(`${token.name} does not belong to the active fleet.`);
  return errors;
}

async function rollDice(formula, flavor, token = null) {
  const roll = await new Roll(formula).evaluate();
  await publishBFGDice(roll, {
    speaker: token ? ChatMessage.getSpeaker({ token: token.document }) : ChatMessage.getSpeaker(),
    flavor
  });
  return { total: Number(roll.total ?? 0), results: diceFaces(roll) };
}

function repairableEffects(state) {
  return Object.values(CRITICAL_RESULTS)
    .filter(result => result.repairable && criticalCount(state, result.id) > 0)
    .map(result => ({ ...result, count: criticalCount(state, result.id) }));
}

function sameCriticalState(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function repairAllocation(element, effects, successes) {
  const allocation = {};
  let spent = 0;
  for (const effect of effects) {
    const input = element.querySelector(`[data-bfg-repair-id="${effect.id}"]`);
    const count = Math.max(0, Math.min(effect.count, Math.trunc(Number(input?.value ?? 0))));
    if (count > 0) allocation[effect.id] = count;
    spent += count;
  }
  if (spent > successes) throw new Error(`Only ${successes} repair allocation${successes === 1 ? " is" : "s are"} available.`);
  return { allocation, spent };
}

export async function resolveSelectedDamageControl() {
  if (!requireGM()) return false;
  const token = selectedShip();
  if (!token) return false;
  if (!requireUserCanControlToken(token, "resolve Damage Control")) return false;
  const state = getTurnState();
  const errors = activeEndPhaseErrors(token, state);
  const combat = getCombatState(token);
  const shipData = getShipData(token);
  if (String(shipData?.stats?.targetClass ?? "capital").toLowerCase() === "escort") errors.push("Escorts cannot attempt Damage Control.");
  if (combat.outOfAction) errors.push("Destroyed ships cannot attempt Damage Control.");
  const activation = endPhaseActivationKey(state);
  if (token.document.getFlag(MODULE_ID, DAMAGE_CONTROL_FLAG)?.activation === activation) errors.push(`${token.name} has already attempted Damage Control in this End Phase.`);
  const criticalState = getCriticalState(token);
  const effects = repairableEffects(criticalState);
  if (!effects.length) errors.push(`${token.name} has no repairable critical effects or fires.`);
  if (errors.length) {
    ui.notifications.warn(errors.join(" "));
    return false;
  }

  const options = await foundry.applications.api.DialogV2.input({
    window: { title: `Damage Control: ${token.name}` },
    content: `<div class="bfg-dialog"><p>Roll one D6 for each remaining hull point. Each 6 provides one repair allocation.</p><label><input type="checkbox" name="blastContact"> Blast Markers are in contact with the ship's base</label><p>Blast Marker contact halves the number of dice, rounding up.</p></div>`,
    ok: { label: "Continue", icon: "fa-solid fa-screwdriver-wrench" },
    rejectClose: false,
    modal: true
  });
  if (!options) return false;

  const blastContact = Boolean(options.blastContact);
  const repairDice = blastContact ? Math.ceil(combat.currentHits / 2) : combat.currentHits;
  return openActionResolution({
    heading: `Damage Control: ${token.name}`,
    rollLabel: "Roll Damage Control",
    applyLabel: "Apply End Phase Results",
    detailsHtml: `<div class="bfg-action-confirmation"><div><span>Remaining hull</span><strong>${combat.currentHits}/${combat.maximumHits}</strong></div><div><span>Blast Marker contact</span><strong>${blastContact ? "Yes" : "No"}</strong></div><div><span>Damage Control dice</span><strong>${repairDice}d6, each needing 6</strong></div>${effects.map(effect => `<div><span>${foundry.utils.escapeHTML(effect.name)}</span><strong>${effect.count}</strong></div>`).join("")}</div><p>After the roll, allocate each successful repair to one occurrence of a repairable effect. Every fire left burning then inflicts one hull damage.</p>`,
    roll: async () => {
      const roll = await rollDice(`${repairDice}d6`, `${token.name}: Damage Control`, token);
      const successes = roll.results.filter(result => result === 6).length;
      return {
        beforeCombat: combat,
        beforeCritical: criticalState,
        effects,
        roll,
        successes,
        activation,
        resultHtml: `<h3>Damage Control result</h3><div class="bfg-action-confirmation"><div><span>Damage Control dice (${repairDice}d6, needing 6)</span><strong>${roll.results.join(", ") || "No dice"}</strong></div><div><span>Successful repairs</span><strong>${successes}</strong></div></div><h3>Allocate repairs</h3><div class="bfg-dialog" data-bfg-step-group data-bfg-step-group-max="${successes}">${effects.map(effect => `<label>${foundry.utils.escapeHTML(effect.name)} (${effect.count} active)</label><div class="bfg-quantity-stepper" data-bfg-stepper><button type="button" data-bfg-step="-1" aria-label="Repair one fewer ${foundry.utils.escapeHTML(effect.name)}" ${successes ? "" : "disabled"}><i class="fa-solid fa-minus"></i></button><input type="number" min="0" max="${Math.min(effect.count, successes)}" step="1" value="0" data-bfg-repair-id="${effect.id}" readonly aria-label="${foundry.utils.escapeHTML(effect.name)} repairs" ${successes ? "" : "disabled"}><button type="button" data-bfg-step="1" aria-label="Repair one more ${foundry.utils.escapeHTML(effect.name)}" ${successes ? "" : "disabled"}><i class="fa-solid fa-plus"></i></button></div>`).join("")}</div><p>Allocate no more than ${successes}. Unspent repairs are lost. Each remaining Fire! effect inflicts one hull damage when the result is applied.</p>`
      };
    },
    apply: async (outcome, element) => {
      const currentCombat = getCombatState(token);
      const currentCritical = getCriticalState(token);
      if (currentCombat.currentHits !== outcome.beforeCombat.currentHits || !sameCriticalState(currentCritical, outcome.beforeCritical)) throw new Error("The ship changed after the roll. Resolve Damage Control again.");
      if (token.document.getFlag(MODULE_ID, DAMAGE_CONTROL_FLAG)?.activation === outcome.activation) throw new Error("Damage Control has already been applied for this ship.");
      const { allocation, spent } = repairAllocation(element, outcome.effects, outcome.successes);
      const afterCritical = foundry.utils.deepClone(currentCritical);
      for (const [id, repaired] of Object.entries(allocation)) {
        const remaining = criticalCount(afterCritical, id) - repaired;
        if (remaining > 0) afterCritical.repairable[id] = remaining;
        else delete afterCritical.repairable[id];
      }
      const remainingFires = criticalCount(afterCritical, "fire");
      const finalHits = Math.max(0, currentCombat.currentHits - remainingFires);
      const appliedCritical = await setCriticalState(token, afterCritical);
      if (!sameCriticalState(appliedCritical, afterCritical)) throw new Error("The repaired critical state could not be stored. No fire damage was applied.");
      await setCombatState(token, { currentHits: finalHits, currentShields: currentCombat.currentShields });
      let catastrophic = null;
      if (finalHits === 0 && currentCombat.currentHits > 0) {
        catastrophic = await rollCatastrophicDamage(token);
        await setCatastrophicState(token, catastrophic);
      }
      await token.document.setFlag(MODULE_ID, DAMAGE_CONTROL_FLAG, { activation: outcome.activation });
      const repairs = outcome.effects
        .filter(effect => allocation[effect.id])
        .map(effect => `${effect.name} x${allocation[effect.id]}`)
        .join(", ") || "None";
      await ChatMessage.create({ content: `<strong>${foundry.utils.escapeHTML(token.name)}: Damage Control applied</strong><br>Successful repairs: ${outcome.successes}; allocated: ${spent}; repaired: ${foundry.utils.escapeHTML(repairs)}.<br>Fires remaining: ${remainingFires}; fire damage: ${remainingFires}; remaining hull: ${finalHits}.${catastrophic ? `<br>Catastrophic result: ${foundry.utils.escapeHTML(catastrophic.name)}.` : ""}` });
    }
  });
}

export async function resolveBlastMarkerRemoval() {
  if (!requireGM()) return false;
  const state = getTurnState();
  if (!state.battleStarted || state.phase !== "end") {
    ui.notifications.warn("Blast Marker removal occurs during the End Phase.");
    return false;
  }
  if (!canvas.scene) {
    ui.notifications.warn("A Scene must be active.");
    return false;
  }
  const activation = endPhaseActivationKey(state);
  if (canvas.scene.getFlag(MODULE_ID, BLAST_REMOVAL_FLAG)?.activation === activation) {
    ui.notifications.warn("Blast Marker removal has already been rolled in this End Phase.");
    return false;
  }
  const fleetName = state.fleets?.[state.activeFleetIndex]?.name ?? "Active fleet";
  return openActionResolution({
    heading: "Blast Marker Removal",
    rollLabel: "Roll Blast Marker Removal",
    applyLabel: "Confirm Removal Allowance",
    detailsHtml: `<div class="bfg-action-confirmation"><div><span>Active fleet</span><strong>${foundry.utils.escapeHTML(fleetName)}</strong></div><div><span>Removal dice</span><strong>1d6</strong></div></div><p>The roll determines how many Blast Markers the active player may manually remove. Markers touching any ship base cannot be removed.</p>`,
    roll: async () => {
      const roll = await rollDice("1d6", `${fleetName}: Blast Marker removal`);
      return { activation, fleetName, allowance: roll.total, roll, resultHtml: `<h3>Blast Marker removal result</h3><div class="bfg-action-confirmation"><div><span>Removal die (1d6)</span><strong>${roll.total}</strong></div><div><span>Blast Markers available to remove</span><strong>${roll.total}</strong></div></div><p>Manually remove up to ${roll.total} eligible Blast Markers. Do not remove markers touching a ship's base.</p>` };
    },
    apply: async outcome => {
      if (endPhaseActivationKey(getTurnState()) !== outcome.activation) throw new Error("The active End Phase changed after the roll. Roll again.");
      if (canvas.scene.getFlag(MODULE_ID, BLAST_REMOVAL_FLAG)?.activation === outcome.activation) throw new Error("This Blast Marker removal allowance was already confirmed.");
      await canvas.scene.setFlag(MODULE_ID, BLAST_REMOVAL_FLAG, { activation: outcome.activation, allowance: outcome.allowance });
      await ChatMessage.create({ content: `<strong>${foundry.utils.escapeHTML(outcome.fleetName)}: Blast Marker removal</strong><br>May manually remove up to ${outcome.allowance} eligible Blast Markers. Markers touching ship bases cannot be removed.` });
    }
  });
}

export async function resetEndPhaseState() {
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.document.getFlag(MODULE_ID, DAMAGE_CONTROL_FLAG) !== undefined) await token.document.unsetFlag(MODULE_ID, DAMAGE_CONTROL_FLAG);
  }
  if (canvas.scene?.getFlag(MODULE_ID, BLAST_REMOVAL_FLAG) !== undefined) await canvas.scene.unsetFlag(MODULE_ID, BLAST_REMOVAL_FLAG);
}
