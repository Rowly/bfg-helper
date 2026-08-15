import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getCombatState, halveRoundedUp } from "./combat-state.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { getTurnState, setTurnState } from "./turn-manager.js";

export const SPECIAL_ORDER_FLAG = "specialOrder";
export const DEFAULT_LEADERSHIP = 8;

export const SPECIAL_ORDERS = Object.freeze({
  "all-ahead-full": { name: "All Ahead Full", weaponFactor: 0.5 },
  "burn-retros": { name: "Burn Retros", weaponFactor: 0.5 },
  "come-to-new-heading": { name: "Come to New Heading", weaponFactor: 0.5 },
  "lock-on": { name: "Lock On", weaponFactor: 1 },
  "reload-ordnance": { name: "Reload Ordnance", weaponFactor: 1 },
  "brace-for-impact": { name: "Brace for Impact!", weaponFactor: 0.5, ordnanceFactor: 0.5 }
});

function activationKey(state = getTurnState()) {
  return `${state.battleId ?? "no-battle"}:${state.round}:${state.activeFleetIndex}`;
}

export function getSpecialOrder(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  const stored = document?.getFlag?.(MODULE_ID, SPECIAL_ORDER_FLAG);
  return stored?.id && SPECIAL_ORDERS[stored.id] ? stored : null;
}

export function getMovementSpecialOrder(tokenOrDocument) {
  const order = getSpecialOrder(tokenOrDocument);
  return order?.id === "brace-for-impact"
    && order.previousOrder?.id
    && order.previousOrder.assignedActivation === activationKey()
    ? order.previousOrder
    : order;
}

export function effectiveWeaponStrength(tokenOrDocument, strength) {
  let value = Math.max(0, Math.trunc(Number(strength)));
  if (getCombatState(tokenOrDocument)?.crippled) value = halveRoundedUp(value);
  if (SPECIAL_ORDERS[getSpecialOrder(tokenOrDocument)?.id]?.weaponFactor === 0.5) value = halveRoundedUp(value);
  return value;
}

export function effectiveOrdnanceStrength(tokenOrDocument, strength) {
  let value = Math.max(0, Math.trunc(Number(strength)));
  if (getCombatState(tokenOrDocument)?.crippled) value = halveRoundedUp(value);
  if (SPECIAL_ORDERS[getSpecialOrder(tokenOrDocument)?.id]?.ordnanceFactor === 0.5) value = halveRoundedUp(value);
  return value;
}

export async function rollBraceSaves(tokenOrDocument, damage, flavor = "Brace for Impact saves") {
  const count = Math.max(0, Math.trunc(Number(damage)));
  if (getSpecialOrder(tokenOrDocument)?.id !== "brace-for-impact" || count === 0) return { dice: [], saved: 0, unsaved: count };
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  const roll = await new Roll(`${count}d6`).evaluate();
  await publishBFGDice(roll, { speaker: ChatMessage.getSpeaker({ token: document }), flavor: `${document.name}: ${flavor}` });
  const dice = diceFaces(roll);
  const saved = dice.filter(value => value >= 4).length;
  return { dice, saved, unsaved: count - saved };
}

function selectedShip() {
  const selected = canvas.tokens?.controlled ?? [];
  if (selected.length !== 1 || !getShipData(selected[0])) {
    ui.notifications.warn("Select exactly one configured ship token.");
    return null;
  }
  return selected[0];
}

function enemyOnOrders(token) {
  const fleetId = getTokenFleetId(token);
  return (canvas.tokens?.placeables ?? []).some(other => getTokenFleetId(other) && getTokenFleetId(other) !== fleetId && getSpecialOrder(other));
}

async function commandCheck(token, { blastContact = false, brace = false } = {}) {
  const state = getTurnState();
  const modifier = (blastContact ? -1 : 0) + (enemyOnOrders(token) ? 1 : 0);
  const leadership = Math.min(10, DEFAULT_LEADERSHIP + modifier);
  const roll = await new Roll("2d6").evaluate();
  await publishBFGDice(roll, { speaker: ChatMessage.getSpeaker({ token: token.document }), flavor: `${token.name}: ${brace ? "Brace for Impact" : "Special Order"} Command check` });
  const total = Number(roll.total);
  return { dice: diceFaces(roll), total, leadership, modifier, passed: total <= leadership && total < 11, activation: activationKey(state) };
}

async function setOrder(token, id, extra = {}) {
  const state = getTurnState();
  const order = { id, name: SPECIAL_ORDERS[id].name, assignedActivation: activationKey(state), assignedRound: state.round, ...extra };
  await token.document.setFlag(MODULE_ID, SPECIAL_ORDER_FLAG, order);
  Hooks.callAll("bfgHelperSpecialOrdersChanged", token.document);
  return order;
}

export async function assignSelectedSpecialOrder() {
  const token = selectedShip();
  if (!token) return false;
  const state = getTurnState();
  const errors = [];
  if (!state.battleStarted || state.phase !== "movement") errors.push("Special Orders are assigned during the Movement phase.");
  if (getCombatState(token)?.outOfAction) errors.push("An out-of-action ship cannot receive Special Orders.");
  if (getTokenFleetId(token) !== state.fleets?.[state.activeFleetIndex]?.id) errors.push("The ship does not belong to the active fleet.");
  const movementState = token.document.getFlag(MODULE_ID, "movementState");
  if (movementState?.moved && movementState.activationKey === `${activationKey(state)}:movement`) errors.push("The ship has already moved.");
  if (state.commandFailureActivation === activationKey(state)) errors.push("A Command check has already failed for this fleet this turn.");
  const existingOrder = getSpecialOrder(token);
  if (existingOrder?.id === "brace-for-impact") errors.push("This ship cannot use Special Orders in this turn after bracing.");
  else if (existingOrder) errors.push(`This ship is already using ${existingOrder.name}.`);
  if (errors.length) { ui.notifications.warn(errors.join(" ")); return false; }
  const shipData = getShipData(token);
  const forbiddenNewHeading = shipData?.movement?.canComeToNewHeading === false
    || ["imperial-retribution", "chaos-despoiler"].includes(String(shipData?.profileId ?? ""));
  const options = Object.entries(SPECIAL_ORDERS)
    .filter(([id]) => id !== "brace-for-impact" && !(id === "come-to-new-heading" && forbiddenNewHeading))
    .map(([id, order]) => `<option value="${id}">${order.name}</option>`).join("");
  const choice = await foundry.applications.api.DialogV2.input({ window: { title: `Assign Special Order: ${token.name}` }, content: `<div class="bfg-dialog"><label>Special Order</label><select name="orderId">${options}</select><label><input type="checkbox" name="blastContact"> Blast Markers in base contact (-1 Leadership)</label><p>Leadership: ${DEFAULT_LEADERSHIP}. Enemy Contacts +1 is detected automatically.</p></div>`, ok: { label: "Roll Command Check", icon: "fa-solid fa-dice-d6" }, rejectClose: false, modal: true });
  if (!choice) return false;
  const orderId = String(choice.orderId ?? "");
  if (!SPECIAL_ORDERS[orderId] || orderId === "brace-for-impact") return false;
  const check = await commandCheck(token, { blastContact: Boolean(choice.blastContact) });
  if (!check.passed) {
    state.commandFailureActivation = activationKey(state);
    await setTurnState(state);
    await ChatMessage.create({ content: `<strong>${token.name} failed its Command check</strong><br>Rolled ${check.total} against Leadership ${check.leadership}. No further normal Special Orders may be attempted by this fleet this turn.` });
    return false;
  }
  let extra = { commandCheck: check };
  if (orderId === "all-ahead-full") {
    const bonus = await new Roll("4d6").evaluate();
    await publishBFGDice(bonus, { speaker: ChatMessage.getSpeaker({ token: token.document }), flavor: `${token.name}: All Ahead Full movement` });
    extra.allAheadFullBonusCm = Number(bonus.total);
  }
  await setOrder(token, orderId, extra);
  if (orderId === "reload-ordnance") {
    const { reloadSelectedShipOrdnance } = await import("./ordnance.js");
    await reloadSelectedShipOrdnance();
  }
  await ChatMessage.create({ content: `<strong>${token.name}: ${SPECIAL_ORDERS[orderId].name}</strong><br>Command check ${check.total} against Leadership ${check.leadership}: passed.` });
  return true;
}

export async function braceSelectedShip() {
  const token = selectedShip();
  if (!token) return false;
  if (getCombatState(token)?.outOfAction) {
    ui.notifications.warn("An out-of-action ship cannot Brace for Impact.");
    return false;
  }
  const choice = await foundry.applications.api.DialogV2.input({ window: { title: `Brace for Impact: ${token.name}` }, content: `<div class="bfg-dialog"><label><input type="checkbox" name="blastContact"> Blast Markers in base contact (-1 Leadership)</label><p>Declare this before the attacking dice are rolled.</p></div>`, ok: { label: "Roll Command Check", icon: "fa-solid fa-shield" }, rejectClose: false, modal: true });
  if (!choice) return false;
  const check = await commandCheck(token, { blastContact: Boolean(choice.blastContact), brace: true });
  if (!check.passed) { ui.notifications.warn(`${token.name} failed to Brace for Impact against this attack.`); return false; }
  const state = getTurnState();
  const shipFleetIndex = state.fleets.findIndex(fleet => fleet.id === getTokenFleetId(token));
  const expiryRound = shipFleetIndex > state.activeFleetIndex ? state.round : state.round + 1;
  const previousOrder = getSpecialOrder(token);
  await setOrder(token, "brace-for-impact", {
    commandCheck: check,
    expiresAtEnd: `${state.battleId}:${expiryRound}:${shipFleetIndex}`,
    previousOrder: previousOrder?.id === "brace-for-impact" ? previousOrder.previousOrder ?? null : previousOrder
  });
  return true;
}

export async function clearFleetOrders(fleetId, state = getTurnState(), {
  clearNormalOrders = true,
  clearExpiringBrace = true
} = {}) {
  const fleetIndex = state.fleets.findIndex(fleet => fleet.id === fleetId);
  const endKey = `${state.battleId}:${state.round}:${fleetIndex}`;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (getTokenFleetId(token) !== fleetId) continue;
    const order = getSpecialOrder(token);
    if (!order) continue;
    const shouldClear = order.id === "brace-for-impact"
      ? clearExpiringBrace && order.expiresAtEnd === endKey
      : clearNormalOrders;
    if (!shouldClear) continue;
    await token.document.unsetFlag(MODULE_ID, SPECIAL_ORDER_FLAG);
  }
  Hooks.callAll("bfgHelperSpecialOrdersChanged");
}

export async function resetSpecialOrders() {
  for (const token of canvas.tokens?.placeables ?? []) if (token.document.getFlag(MODULE_ID, SPECIAL_ORDER_FLAG) !== undefined) await token.document.unsetFlag(MODULE_ID, SPECIAL_ORDER_FLAG);
  Hooks.callAll("bfgHelperSpecialOrdersChanged");
}
