import { MODULE_ID } from "./constants.js";
import { getActingFleetIndex, getTurnState } from "./turn-manager.js";

const BASELINE_FLAG = "fleetOwnershipBaseline";

function tokenDocument(tokenOrDocument) {
  if (tokenOrDocument?.document?.documentName === "Token") return tokenOrDocument.document;
  if (tokenOrDocument?.documentName === "Token") return tokenOrDocument;
  return null;
}

export function getFleetController(fleetId, state = getTurnState()) {
  const fleet = state.fleets?.find(item => item.id === String(fleetId ?? ""));
  return fleet?.ownerUserId ? game.users?.get(fleet.ownerUserId) ?? null : null;
}

export function getFleetControllerName(fleet, fallback = "Unassigned") {
  if (!fleet?.ownerUserId) return fallback;
  return game.users?.get(fleet.ownerUserId)?.name ?? "Unknown player";
}

export function canUserControlFleet(fleetId, user = game.user, state = getTurnState()) {
  if (user?.isGM) return true;
  if (!user || !fleetId) return false;
  const fleet = state.fleets?.find(item => item.id === String(fleetId));
  return Boolean(fleet?.ownerUserId && fleet.ownerUserId === user.id);
}

export function canUserControlActingFleet(user = game.user, state = getTurnState()) {
  const fleet = state.fleets?.[getActingFleetIndex(state)];
  return canUserControlFleet(fleet?.id, user, state);
}

export function canUserControlToken(tokenOrDocument, user = game.user, state = getTurnState()) {
  const document = tokenDocument(tokenOrDocument);
  if (user?.isGM) return true;
  const fleetId = document?.getFlag(MODULE_ID, "fleetId")
    ?? document?.getFlag(MODULE_ID, "ordnanceMarker")?.fleetId;
  return canUserControlFleet(fleetId, user, state);
}

export function requireUserCanControlToken(tokenOrDocument, action = "use this token") {
  if (canUserControlToken(tokenOrDocument)) return true;
  const document = tokenDocument(tokenOrDocument);
  ui.notifications.warn(`You do not control ${document?.name ?? "this token"} and cannot ${action}.`);
  return false;
}

function assignedOwnership(ownerUserId, state) {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  // Combat resolution writes state to opposing tokens. Give participating
  // players the document access required for those writes, while the control
  // hooks below enforce which fleet each player may actually operate.
  for (const fleet of state.fleets ?? []) {
    if (fleet.ownerUserId) ownership[fleet.ownerUserId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  }
  if (ownerUserId) ownership[ownerUserId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  return ownership;
}

export async function syncFleetTokenOwnership(tokenOrDocument, state = getTurnState()) {
  if (!game.user?.isGM) return false;
  const document = tokenDocument(tokenOrDocument);
  if (!document?.actor) return false;

  const fleetId = document.getFlag(MODULE_ID, "fleetId")
    ?? document.getFlag(MODULE_ID, "ordnanceMarker")?.fleetId;
  const fleet = state.fleets?.find(item => item.id === String(fleetId ?? ""));
  if (!state.battleStarted || !fleet) return restoreFleetTokenOwnership(document);

  let baseline = document.getFlag(MODULE_ID, BASELINE_FLAG);
  if (!baseline) {
    baseline = {
      actorLink: Boolean(document.actorLink),
      ownership: foundry.utils.deepClone(document.actor?.ownership ?? {})
    };
    await document.setFlag(MODULE_ID, BASELINE_FLAG, baseline);
  }

  if (document.actorLink) await document.update({ actorLink: false });
  await document.delta.update({ ownership: assignedOwnership(fleet.ownerUserId, state) });
  return true;
}

export async function restoreFleetTokenOwnership(tokenOrDocument) {
  if (!game.user?.isGM) return false;
  const document = tokenDocument(tokenOrDocument);
  const baseline = document?.getFlag(MODULE_ID, BASELINE_FLAG);
  if (!document || !baseline) return false;

  if (!document.actorLink && document.delta) {
    await document.delta.update({ ownership: foundry.utils.deepClone(baseline.ownership ?? {}) });
  }
  if (Boolean(document.actorLink) !== Boolean(baseline.actorLink)) {
    await document.update({ actorLink: Boolean(baseline.actorLink) });
  }
  await document.unsetFlag(MODULE_ID, BASELINE_FLAG);
  return true;
}

export async function syncAllFleetTokenOwnership(state = getTurnState()) {
  if (!game.user?.isGM || !canvas?.ready) return 0;
  let count = 0;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (await syncFleetTokenOwnership(token, state)) count += 1;
  }
  return count;
}

export async function restoreAllFleetTokenOwnership() {
  if (!game.user?.isGM || !canvas?.ready) return 0;
  let count = 0;
  for (const token of canvas.tokens?.placeables ?? []) {
    if (await restoreFleetTokenOwnership(token)) count += 1;
  }
  return count;
}

export function preventUnauthorizedFleetTokenUpdate(document, changes, _options, userId) {
  const user = game.users?.get(userId);
  if (!getTurnState().battleStarted || user?.isGM) return true;
  const positional = ["x", "y", "rotation", "elevation", "width", "height"].some(key => key in changes);
  if (!positional) return true;
  if (canUserControlToken(document, user)) return true;
  if (user?.id === game.user?.id) ui.notifications.warn(`You do not control ${document.name}.`);
  return false;
}

export function enforceFleetTokenControl(token, controlled) {
  if (!controlled || !getTurnState().battleStarted || canUserControlToken(token)) return;
  token.release();
  ui.notifications.warn(`You do not control ${token.name}.`);
}
