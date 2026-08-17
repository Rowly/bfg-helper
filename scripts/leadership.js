import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { getCombatState } from "./combat-state.js";
import { diceFaces, publishBFGDice } from "./dice.js";

export const LEADERSHIP_FLAG = "leadership";
export const LEADERSHIP_TABLE = Object.freeze([
  { min: 1, max: 1, value: 6, rating: "Untried" },
  { min: 2, max: 3, value: 7, rating: "Experienced" },
  { min: 4, max: 5, value: 8, rating: "Veteran" },
  { min: 6, max: 6, value: 9, rating: "Crack" }
]);

function tokenDocument(tokenOrDocument) {
  return tokenOrDocument?.document ?? tokenOrDocument;
}

function selectedShip() {
  const selected = canvas.tokens?.controlled ?? [];
  if (selected.length !== 1 || !getShipData(selected[0])) {
    ui.notifications.warn("Select exactly one configured ship token.");
    return null;
  }
  return selected[0];
}

function requireGM() {
  if (game.user?.isGM) return true;
  ui.notifications.warn("Only a Gamemaster can assign starting Leadership.");
  return false;
}

function resultForRoll(roll) {
  return LEADERSHIP_TABLE.find(entry => roll >= entry.min && roll <= entry.max);
}

function resultForValue(value) {
  return LEADERSHIP_TABLE.find(entry => entry.value === value);
}

export function getLeadership(tokenOrDocument) {
  const stored = tokenDocument(tokenOrDocument)?.getFlag?.(MODULE_ID, LEADERSHIP_FLAG);
  const value = Number(stored?.value);
  if (!Number.isInteger(value) || value < 6 || value > 9) return null;
  return {
    value,
    rating: String(stored.rating || resultForValue(value)?.rating || "Unknown"),
    roll: stored.roll !== null && stored.roll !== undefined && Number.isInteger(Number(stored.roll)) ? Number(stored.roll) : null,
    source: String(stored.source || "manual"),
    scope: String(stored.scope || "ship")
  };
}

export function getBaseLeadership(tokenOrDocument, fallback = 8) {
  return getLeadership(tokenOrDocument)?.value ?? fallback;
}

export function getEffectiveLeadership(tokenOrDocument, modifier = 0) {
  const base = getBaseLeadership(tokenOrDocument);
  const bridgePenalty = Math.max(0, Number(getCombatState(tokenOrDocument)?.leadershipPenalty ?? 0));
  return Math.max(0, Math.min(10, base - bridgePenalty + Number(modifier || 0)));
}

export async function setLeadership(tokenOrDocument, value, { roll = null, source = "manual" } = {}) {
  const document = tokenDocument(tokenOrDocument);
  const result = resultForValue(Number(value));
  if (!document || !result) throw new Error("Leadership must be a value from 6 to 9.");
  const state = {
    value: result.value,
    rating: result.rating,
    roll: roll !== null && roll !== undefined && Number.isInteger(Number(roll)) ? Number(roll) : null,
    source,
    // Squadron support can replace this scope when that milestone is implemented.
    scope: "ship"
  };
  await document.setFlag(MODULE_ID, LEADERSHIP_FLAG, state);
  Hooks.callAll("bfgHelperLeadershipChanged", document, state);
  return state;
}

export async function rollLeadership(tokenOrDocument) {
  const document = tokenDocument(tokenOrDocument);
  if (!document || !getShipData(document)) throw new Error("A configured ship token is required.");
  const roll = await new Roll("1d6").evaluate();
  await publishBFGDice(roll, {
    speaker: ChatMessage.getSpeaker({ token: document }),
    flavor: `${document.name}: Starting Leadership`
  });
  const face = diceFaces(roll)[0];
  const result = resultForRoll(face);
  const state = await setLeadership(document, result.value, { roll: face, source: "rolled" });
  await ChatMessage.create({
    content: `<strong>${foundry.utils.escapeHTML(document.name)}: ${state.rating}</strong><br>Leadership roll ${face}: Leadership ${state.value}.`
  });
  return state;
}

export async function rollSelectedShipLeadership() {
  if (!requireGM()) return false;
  const token = selectedShip();
  return token ? rollLeadership(token) : false;
}

export async function editSelectedShipLeadership() {
  if (!requireGM()) return false;
  const token = selectedShip();
  if (!token) return false;
  const current = getBaseLeadership(token);
  const options = LEADERSHIP_TABLE.map(entry => `<option value="${entry.value}" ${entry.value === current ? "selected" : ""}>${entry.rating} (Leadership ${entry.value})</option>`).join("");
  const choice = await foundry.applications.api.DialogV2.input({
    window: { title: `Set Leadership: ${token.name}` },
    content: `<div class="bfg-dialog"><label>Leadership</label><select name="leadership">${options}</select><p>Manual assignment replaces any previously rolled starting Leadership.</p></div>`,
    ok: { label: "Set Leadership", icon: "fa-solid fa-user-shield" },
    rejectClose: false,
    modal: true
  });
  if (!choice) return false;
  return setLeadership(token, Number(choice.leadership), { source: "manual" });
}

export async function clearSelectedShipLeadership() {
  if (!requireGM()) return false;
  const token = selectedShip();
  if (!token) return false;
  await token.document.unsetFlag(MODULE_ID, LEADERSHIP_FLAG);
  Hooks.callAll("bfgHelperLeadershipChanged", token.document, null);
  return true;
}

export async function rollAllUnassignedLeadership() {
  if (!requireGM()) return false;
  const ships = (canvas.tokens?.placeables ?? []).filter(token => getShipData(token) && token.document.getFlag(MODULE_ID, "fleetId") && !getLeadership(token));
  for (const ship of ships) await rollLeadership(ship);
  if (!ships.length) ui.notifications.info("All assigned ships already have Leadership values.");
  return ships.length;
}

export function getShipsMissingLeadership() {
  return (canvas.tokens?.placeables ?? []).filter(token => {
    const fleetId = token.document.getFlag(MODULE_ID, "fleetId");
    return getShipData(token) && ["fleet-a", "fleet-b"].includes(fleetId) && !getLeadership(token);
  });
}
