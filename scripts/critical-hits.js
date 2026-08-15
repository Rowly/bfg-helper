import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { diceFaces, publishBFGDice } from "./dice.js";

export const CRITICAL_HITS_FLAG = "criticalHits";

export const CRITICAL_RESULTS = Object.freeze({
  2: { id: "dorsal-armament", name: "Dorsal Armament Damaged", repairable: true },
  3: { id: "starboard-armament", name: "Starboard Armament Damaged", repairable: true },
  4: { id: "port-armament", name: "Port Armament Damaged", repairable: true },
  5: { id: "prow-armament", name: "Prow Armament Damaged", repairable: true },
  6: { id: "engine-room", name: "Engine Room Damaged", repairable: true, extra: "1" },
  7: { id: "fire", name: "Fire!", repairable: true },
  8: { id: "thrusters", name: "Thrusters Damaged", repairable: true, extra: "1" },
  9: { id: "bridge-smashed", name: "Bridge Smashed", repairable: false },
  10: { id: "shields-collapse", name: "Shields Collapse", repairable: false },
  11: { id: "hull-breach", name: "Hull Breach", repairable: false, extra: "1d3" },
  12: { id: "bulkhead-collapse", name: "Bulkhead Collapse", repairable: false, extra: "1d6" }
});

function asTokenDocument(tokenOrDocument) {
  if (tokenOrDocument?.document?.documentName === "Token") return tokenOrDocument.document;
  return tokenOrDocument?.documentName === "Token" ? tokenOrDocument : null;
}

function emptyState() {
  return { repairable: {}, permanent: [] };
}

export function getCriticalState(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  const stored = document?.getFlag(MODULE_ID, CRITICAL_HITS_FLAG) ?? {};
  const repairable = {};
  for (const [id, count] of Object.entries(stored.repairable ?? {})) {
    const value = Math.max(0, Math.trunc(Number(count)));
    if (value > 0) repairable[id] = value;
  }
  const permanent = [...new Set((stored.permanent ?? []).map(String))];
  return { repairable, permanent };
}

export function criticalCount(state, id) {
  return Math.max(0, Math.trunc(Number(state?.repairable?.[id] ?? 0)));
}

export function hasCritical(state, id) {
  return criticalCount(state, id) > 0 || state?.permanent?.includes(id);
}

function weaponLocation(weapon) {
  const text = `${weapon?.id ?? ""} ${weapon?.name ?? ""}`.toLowerCase();
  if (text.includes("dorsal")) return "dorsal";
  if (text.includes("starboard")) return "starboard";
  if (text.includes("port")) return "port";
  if (text.includes("prow")) return "prow";
  return null;
}

export function weaponCriticalId(weapon) {
  const location = weaponLocation(weapon);
  return location ? `${location}-armament` : null;
}

export function isWeaponDisabledByCritical(weapon, criticalState) {
  const id = weaponCriticalId(weapon);
  return Boolean(id && criticalCount(criticalState, id) > 0);
}

function hasArmament(shipData, location) {
  return [...(shipData?.weapons ?? []), ...(shipData?.ordnance ?? [])]
    .some(weapon => weaponLocation(weapon) === location);
}

function resultApplicable(result, shipData, state) {
  if (result.id.endsWith("-armament")) {
    return hasArmament(shipData, result.id.replace("-armament", ""));
  }
  if (!result.repairable && ["bridge-smashed", "shields-collapse"].includes(result.id)) {
    return !state.permanent.includes(result.id);
  }
  return true;
}

function resolveApplicableResult(rolledTotal, shipData, state) {
  for (let total = rolledTotal; total <= 12; total += 1) {
    const result = CRITICAL_RESULTS[total];
    if (resultApplicable(result, shipData, state)) return { total, result };
  }
  return { total: 12, result: CRITICAL_RESULTS[12] };
}

function addEffect(state, result) {
  if (result.repairable) {
    state.repairable[result.id] = criticalCount(state, result.id) + 1;
  } else if (["bridge-smashed", "shields-collapse"].includes(result.id)) {
    state.permanent.push(result.id);
  }
}

async function rollValues(formula, flavor, document) {
  const roll = await new Roll(formula).evaluate();
  await publishBFGDice(roll, {
    speaker: ChatMessage.getSpeaker({ token: document }),
    flavor
  });
  return {
    total: Number(roll.total ?? 0),
    values: diceFaces(roll)
  };
}

export async function rollCriticalHits(tokenOrDocument, hullDamage) {
  const document = asTokenDocument(tokenOrDocument);
  const shipData = getShipData(document);
  const checks = Math.max(0, Math.trunc(Number(hullDamage)));
  const before = getCriticalState(document);
  const after = foundry.utils.deepClone(before);
  const targetClass = String(shipData?.stats?.targetClass ?? "capital").toLowerCase();
  const checkRoll = checks > 0
    ? await rollValues(`${checks}d6`, `${document.name}: Critical-hit checks`, document)
    : { total: 0, values: [] };
  const triggers = checkRoll.values.filter(value => value === 6).length;
  const results = [];
  let extraDamage = 0;

  if (targetClass === "escort" && triggers > 0) {
    return {
      checks,
      checkResults: checkRoll.values,
      triggers,
      escortDestroyed: true,
      results,
      extraDamage: 0,
      before,
      after
    };
  }

  for (let index = 0; index < triggers; index += 1) {
    const tableRoll = await rollValues("2d6", `${document.name}: Critical Hits table`, document);
    const applicable = resolveApplicableResult(tableRoll.total, shipData, after);
    let extraRoll = null;
    if (applicable.result.extra) {
      extraRoll = await rollValues(applicable.result.extra, `${document.name}: ${applicable.result.name} extra damage`, document);
      extraDamage += extraRoll.total;
    }
    addEffect(after, applicable.result);
    results.push({
      rolledTotal: tableRoll.total,
      tableDice: tableRoll.values,
      appliedTotal: applicable.total,
      shifted: applicable.total !== tableRoll.total,
      ...applicable.result,
      extraDamage: extraRoll?.total ?? 0,
      extraDice: extraRoll?.values ?? []
    });
  }

  return { checks, checkResults: checkRoll.values, triggers, escortDestroyed: false, results, extraDamage, before, after };
}

/** Apply one specified Critical Hits table result, used by Hit-and-Run and boarding. */
export async function previewCriticalTableResult(tokenOrDocument, rolledTotal, { flavor = "Critical effect", state = null } = {}) {
  const document = asTokenDocument(tokenOrDocument);
  const shipData = getShipData(document);
  if (!document || !shipData) throw new Error("A configured deployed ship is required.");
  const before = state ? foundry.utils.deepClone(state) : getCriticalState(document);
  const after = foundry.utils.deepClone(before);
  const applicable = resolveApplicableResult(Math.max(2, Math.min(12, Math.trunc(Number(rolledTotal)))), shipData, after);
  let extraDamage = 0;
  let extraDice = [];
  if (applicable.result.extra) {
    const extra = await rollValues(applicable.result.extra, `${document.name}: ${flavor}, ${applicable.result.name}`, document);
    extraDamage = extra.total;
    extraDice = extra.values;
  }
  addEffect(after, applicable.result);
  return {
    rolledTotal: Number(rolledTotal),
    appliedTotal: applicable.total,
    shifted: applicable.total !== Number(rolledTotal),
    ...applicable.result,
    extraDamage,
    extraDice,
    before,
    after
  };
}

export async function applyCriticalTableResult(tokenOrDocument, rolledTotal, options = {}) {
  const result = await previewCriticalTableResult(tokenOrDocument, rolledTotal, options);
  await setCriticalState(tokenOrDocument, result.after);
  return result;
}

export async function setCriticalState(tokenOrDocument, state) {
  const document = asTokenDocument(tokenOrDocument);
  if (!document) throw new Error("A deployed ship token is required.");
  await document.setFlag(MODULE_ID, CRITICAL_HITS_FLAG, {
    repairable: state?.repairable ?? {},
    permanent: state?.permanent ?? []
  });
  if (state?.permanent?.includes("shields-collapse")) {
    const combatState = document.getFlag(MODULE_ID, "combatState") ?? {};
    await document.setFlag(MODULE_ID, "combatState", { ...combatState, currentShields: 0 });
  }
  Hooks.callAll("bfgHelperCriticalStateChanged", document, getCriticalState(document));
  return getCriticalState(document);
}

export async function clearCriticalState(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  if (!document) return false;
  await document.unsetFlag(MODULE_ID, CRITICAL_HITS_FLAG);
  Hooks.callAll("bfgHelperCriticalStateChanged", document, emptyState());
  return true;
}

export function criticalStateSummary(state) {
  const entries = [];
  for (const [id, count] of Object.entries(state?.repairable ?? {})) {
    const result = Object.values(CRITICAL_RESULTS).find(item => item.id === id);
    if (result && count > 0) entries.push({ id, name: result.name, count, repairable: true });
  }
  for (const id of state?.permanent ?? []) {
    const result = Object.values(CRITICAL_RESULTS).find(item => item.id === id);
    if (result) entries.push({ id, name: result.name, count: 1, repairable: false });
  }
  return entries;
}

export async function editSelectedShipCriticalState() {
  if (!game.user?.isGM) {
    ui.notifications.warn("Only a Gamemaster can change critical-hit state.");
    return false;
  }
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length !== 1) {
    ui.notifications.warn("Please select exactly one configured ship token.");
    return false;
  }

  const token = controlled[0];
  if (!getShipData(token)) {
    ui.notifications.warn(`${token.name} is not a configured ship.`);
    return false;
  }
  const state = getCriticalState(token);
  const repairableResults = Object.values(CRITICAL_RESULTS)
    .filter(result => result.repairable);
  const permanentResults = Object.values(CRITICAL_RESULTS)
    .filter(result => ["bridge-smashed", "shields-collapse"].includes(result.id));
  const content = `
    <div class="bfg-dialog">
      <p>Correct active critical effects. Repairable effects are cumulative; permanent effects cannot normally be repaired.</p>
      ${repairableResults.map(result => `
        <label>${foundry.utils.escapeHTML(result.name)}</label>
        <input type="number" name="${result.id}" min="0" step="1" value="${criticalCount(state, result.id)}">
      `).join("")}
      ${permanentResults.map(result => `
        <label><input type="checkbox" name="${result.id}" ${state.permanent.includes(result.id) ? "checked" : ""}> ${foundry.utils.escapeHTML(result.name)}</label>
      `).join("")}
    </div>`;
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: `Critical Effects: ${token.name}` },
    content,
    ok: { label: "Apply Critical State", icon: "fa-solid fa-burst" },
    rejectClose: false,
    modal: true
  });
  if (!result) return false;

  const repairable = {};
  for (const critical of repairableResults) {
    const count = Math.max(0, Math.trunc(Number(result[critical.id] ?? 0)));
    if (count > 0) repairable[critical.id] = count;
  }
  const permanent = permanentResults
    .filter(critical => Boolean(result[critical.id]))
    .map(critical => critical.id);
  await setCriticalState(token, { repairable, permanent });
  return true;
}
