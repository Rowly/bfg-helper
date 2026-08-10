import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";

export const COMBAT_STATE_FLAG = "combatState";

function asTokenDocument(tokenOrDocument) {
  if (tokenOrDocument?.document?.documentName === "Token") {
    return tokenOrDocument.document;
  }
  return tokenOrDocument?.documentName === "Token" ? tokenOrDocument : null;
}

function requireGM() {
  if (game.user?.isGM) return true;
  ui.notifications.warn("Only a Gamemaster can change ship combat state.");
  return false;
}

function wholeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function profileMaximums(tokenOrDocument) {
  const data = getShipData(tokenOrDocument);
  const maximumHits = wholeNumber(data?.stats?.hits, 0);
  const maximumShields = wholeNumber(data?.stats?.shields, 0);

  if (!(maximumHits > 0) || maximumShields < 0) return null;
  return { data, maximumHits, maximumShields };
}

/** Return normalized current and derived combat state for a deployed ship. */
export function getCombatState(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  const profile = profileMaximums(document);
  if (!document || !profile) return null;

  const stored = document.getFlag(MODULE_ID, COMBAT_STATE_FLAG) ?? {};
  const currentHits = Math.max(
    0,
    Math.min(profile.maximumHits, wholeNumber(stored.currentHits, profile.maximumHits))
  );
  const currentShields = Math.max(
    0,
    Math.min(profile.maximumShields, wholeNumber(stored.currentShields, profile.maximumShields))
  );

  return {
    currentHits,
    maximumHits: profile.maximumHits,
    currentShields,
    maximumShields: profile.maximumShields,
    armour: String(profile.data.stats.armour ?? ""),
    crippled: currentHits > 0 && currentHits <= profile.maximumHits / 2,
    outOfAction: currentHits <= 0,
    initialised: Boolean(document.getFlag(MODULE_ID, COMBAT_STATE_FLAG))
  };
}

export async function setCombatState(tokenOrDocument, values = {}) {
  if (!requireGM()) return false;

  const document = asTokenDocument(tokenOrDocument);
  const current = getCombatState(document);
  if (!document || !current) {
    ui.notifications.warn("This ship profile does not have valid hits and shields statistics.");
    return false;
  }

  const next = {
    currentHits: Math.max(
      0,
      Math.min(current.maximumHits, wholeNumber(values.currentHits, current.currentHits))
    ),
    currentShields: Math.max(
      0,
      Math.min(current.maximumShields, wholeNumber(values.currentShields, current.currentShields))
    )
  };

  await document.setFlag(MODULE_ID, COMBAT_STATE_FLAG, next);
  Hooks.callAll("bfgHelperCombatStateChanged", document, getCombatState(document));
  return getCombatState(document);
}

export async function resetCombatState(tokenOrDocument, { notify = true } = {}) {
  const document = asTokenDocument(tokenOrDocument);
  const current = getCombatState(document);
  if (!document || !current) return false;

  const result = await setCombatState(document, {
    currentHits: current.maximumHits,
    currentShields: current.maximumShields
  });

  if (result && notify) {
    ui.notifications.info(`${document.name} combat state restored.`);
  }
  return result;
}

export async function initialiseCombatState(tokenOrDocument) {
  const state = getCombatState(tokenOrDocument);
  if (!state) return false;
  return state.initialised
    ? state
    : resetCombatState(tokenOrDocument, { notify: false });
}

/** Initialize missing token state without restoring ships which are damaged. */
export async function initialiseBattleCombatStates() {
  if (!requireGM() || !canvas?.ready) return false;

  let count = 0;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!token.document.getFlag(MODULE_ID, "fleetId")) continue;
    const state = getCombatState(token);
    if (!state || state.initialised) continue;
    if (await initialiseCombatState(token)) count += 1;
  }
  return count;
}

export async function resetAllCombatStates() {
  if (!requireGM() || !canvas?.ready) return false;

  let count = 0;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (!getCombatState(token)) continue;
    if (await resetCombatState(token, { notify: false })) count += 1;
  }
  return count;
}

function selectedConfiguredShip() {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length !== 1) {
    ui.notifications.warn("Please select exactly one configured ship token.");
    return null;
  }

  const token = controlled[0];
  if (!getCombatState(token)) {
    ui.notifications.warn(`${token.name} does not have valid combat statistics.`);
    return null;
  }
  return token;
}

export async function editSelectedShipCombatState() {
  if (!requireGM()) return false;
  const token = selectedConfiguredShip();
  if (!token) return false;

  const state = getCombatState(token);
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: `Combat State: ${token.name}` },
    content: `
      <div class="bfg-dialog">
        <p>Correct the deployed ship's current battle state. Profile maximums are shown for reference.</p>
        <label>Current hits (maximum ${state.maximumHits})</label>
        <input type="number" name="currentHits" min="0" max="${state.maximumHits}" step="1" value="${state.currentHits}">
        <label>Current shields (maximum ${state.maximumShields})</label>
        <input type="number" name="currentShields" min="0" max="${state.maximumShields}" step="1" value="${state.currentShields}">
      </div>`,
    ok: { label: "Apply Combat State", icon: "fa-solid fa-heart-pulse" },
    rejectClose: false,
    modal: true
  });

  if (!result) return false;
  const updated = await setCombatState(token, result);
  if (updated) ui.notifications.info(`${token.name} combat state updated.`);
  return Boolean(updated);
}

export async function resetSelectedShipCombatState() {
  if (!requireGM()) return false;
  const token = selectedConfiguredShip();
  return token ? resetCombatState(token) : false;
}
