import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import {
  clearCriticalState,
  criticalCount,
  criticalStateSummary,
  getCriticalState,
  hasCritical
} from "./critical-hits.js";
import { clearCatastrophicState, getCatastrophicState, isHulk } from "./catastrophic-damage.js";

export const COMBAT_STATE_FLAG = "combatState";

export function halveRoundedUp(value) {
  return Math.ceil(Math.max(0, Number(value) || 0) / 2);
}

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

function profileArmour(stats) {
  const configured = stats?.armour;
  if (configured && typeof configured === "object") {
    const front = String(configured.front ?? configured.other ?? "");
    const other = String(configured.other ?? configured.front ?? "");
    return {
      armour: front === other ? front : `${front} front / ${other} other`,
      armourFront: front,
      armourOther: other
    };
  }

  const armour = String(configured ?? "");
  return { armour, armourFront: armour, armourOther: armour };
}

/** Return normalized current and derived combat state for a deployed ship. */
export function getCombatState(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  const profile = profileMaximums(document);
  if (!document || !profile) return null;

  const stored = document.getFlag(MODULE_ID, COMBAT_STATE_FLAG) ?? {};
  const criticalState = getCriticalState(document);
  const currentHits = Math.max(
    0,
    Math.min(profile.maximumHits, wholeNumber(stored.currentHits, profile.maximumHits))
  );
  const crippled = currentHits > 0 && currentHits <= profile.maximumHits / 2;
  const catastrophicState = getCatastrophicState(document);
  const shieldsCollapsed = hasCritical(criticalState, "shields-collapse");
  const effectiveMaximumShields = currentHits <= 0 || shieldsCollapsed
    ? 0
    : crippled
      ? halveRoundedUp(profile.maximumShields)
      : profile.maximumShields;
  const currentShields = Math.max(
    0,
    Math.min(effectiveMaximumShields, wholeNumber(stored.currentShields, effectiveMaximumShields))
  );

  const armour = profileArmour(profile.data.stats);

  return {
    currentHits,
    maximumHits: profile.maximumHits,
    currentShields,
    maximumShields: effectiveMaximumShields,
    profileMaximumShields: profile.maximumShields,
    ...armour,
    criticalState,
    catastrophicState,
    hulk: isHulk(catastrophicState),
    criticals: criticalStateSummary(criticalState),
    engineRoomDamage: criticalCount(criticalState, "engine-room"),
    thrusterDamage: criticalCount(criticalState, "thrusters"),
    fires: criticalCount(criticalState, "fire"),
    leadershipPenalty: hasCritical(criticalState, "bridge-smashed") ? 3 : 0,
    shieldsCollapsed,
    profileTurrets: wholeNumber(profile.data.stats?.turrets, 0),
    effectiveTurrets: currentHits <= 0
      ? 0
      : crippled
      ? halveRoundedUp(profile.data.stats?.turrets)
      : wholeNumber(profile.data.stats?.turrets, 0),
    effectiveOrdnance: (profile.data.ordnance ?? []).map(item => ({
      id: item.id,
      strength: crippled ? halveRoundedUp(item.strength ?? item.capacity) : Number(item.strength ?? item.capacity ?? 0)
    })),
    crippled,
    novaCannonDisabled: crippled,
    outOfAction: currentHits <= 0,
    initialised: Boolean(document.getFlag(MODULE_ID, COMBAT_STATE_FLAG))
  };
}

export async function setCombatState(tokenOrDocument, values = {}) {
  const document = asTokenDocument(tokenOrDocument);
  if (!game.user?.isGM && !document?.canUserModify?.(game.user, "update")) {
    ui.notifications.warn("You do not have permission to update this ship's combat state.");
    return false;
  }
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

export function previewHitDamage(tokenOrDocument, hits) {
  const state = getCombatState(tokenOrDocument);
  if (!state) throw new Error("The target does not have valid combat state.");

  const totalHits = Math.max(0, Math.trunc(Number(hits)));
  const shieldHits = Math.min(state.currentShields, totalHits);
  const hullHits = Math.min(state.currentHits, Math.max(0, totalHits - shieldHits));
  const currentShields = state.currentShields - shieldHits;
  const currentHits = state.currentHits - hullHits;
  const crippled = currentHits > 0 && currentHits <= state.maximumHits / 2;
  const maximumShields = state.shieldsCollapsed
    ? 0
    : crippled
      ? halveRoundedUp(state.profileMaximumShields)
      : state.profileMaximumShields;

  return {
    totalHits,
    shieldHits,
    hullHits,
    before: state,
    after: {
      currentHits,
      currentShields: Math.min(currentShields, maximumShields),
      crippled,
      outOfAction: currentHits <= 0
    }
  };
}

export async function applyHitDamage(tokenOrDocument, hits) {
  const preview = previewHitDamage(tokenOrDocument, hits);
  const updated = await setCombatState(tokenOrDocument, preview.after);
  return updated ? { ...preview, updated } : false;
}

export async function resetCombatState(tokenOrDocument, { notify = true } = {}) {
  const document = asTokenDocument(tokenOrDocument);
  const current = getCombatState(document);
  if (!document || !current) return false;

  await clearCriticalState(document);
  await clearCatastrophicState(document);
  const result = await setCombatState(document, {
    currentHits: current.maximumHits,
    currentShields: current.profileMaximumShields
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
