import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";

const ROTATION_LOCK_FLAG = "rotationLocked";
export const ROTATION_UPDATE_OVERRIDE = "bfgHelperRotationOverride";

function asTokenDocument(tokenOrDocument) {
  if (tokenOrDocument?.document?.documentName === "Token") {
    return tokenOrDocument.document;
  }

  return tokenOrDocument?.documentName === "Token" ? tokenOrDocument : null;
}

function requireGM() {
  if (game.user?.isGM) return true;
  ui.notifications.warn("Only a Gamemaster can change ship rotation locks.");
  return false;
}

/** A battle ship is a configured BFG token which has a deployed fleet assignment. */
export function isDeployedBattleShip(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  if (!document) return false;

  const fleetId = document.getFlag(MODULE_ID, "fleetId");
  return Boolean(fleetId && getShipData(document));
}

function isConfiguredShip(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  return Boolean(document && getShipData(document));
}

export async function setTokenRotationLock(tokenOrDocument, locked) {
  const document = asTokenDocument(tokenOrDocument);
  if (!document) throw new Error("No TokenDocument supplied.");

  const wanted = Boolean(locked);
  const flagLocked = Boolean(document.getFlag(MODULE_ID, ROTATION_LOCK_FLAG));
  const artworkLocked = Boolean(document.lockRotation);
  if (flagLocked === wanted && !artworkLocked) return false;

  /*
   * Foundry's lockRotation field locks the artwork orientation, not changes to
   * the TokenDocument rotation value. Keep it false and use our own flag plus
   * a preUpdateToken guard so the ship and attached effects share one heading.
   */
  await document.update({
    lockRotation: false,
    [`flags.${MODULE_ID}.${ROTATION_LOCK_FLAG}`]: wanted
  });
  return true;
}

/** Reject manual rotation updates while the BFG battle lock is active. */
export function preventLockedTokenRotation(tokenDocument, changes, options, userId) {
  if (!Object.hasOwn(changes ?? {}, "rotation")) return;
  if (options?.[ROTATION_UPDATE_OVERRIDE]) return;
  if (!tokenDocument.getFlag(MODULE_ID, ROTATION_LOCK_FLAG)) return;

  const currentRotation = Number(tokenDocument.rotation ?? 0);
  const requestedRotation = Number(changes.rotation);
  if (Number.isFinite(requestedRotation) && requestedRotation === currentRotation) return;

  if (userId === game.user?.id) {
    ui.notifications.warn(
      `${tokenDocument.name ?? "This ship"} cannot be rotated while its battle rotation lock is active.`
    );
  }

  return false;
}

/**
 * Lock configured, fleet-assigned ships on the active canvas. Unlocking is
 * deliberately broader and clears the lock from every configured ship, even
 * if a fleet flag was removed outside the normal assignment workflow. Actor
 * prototype tokens are left unlocked so deployment remains freely adjustable.
 */
export async function setBattleShipRotationLocks(locked) {
  if (!requireGM()) return false;
  if (!canvas?.ready) {
    ui.notifications.warn("The battlefield canvas must be ready to change ship rotation locks.");
    return false;
  }

  const documents = (canvas.tokens?.placeables ?? [])
    .map(token => token.document)
    .filter(locked ? isDeployedBattleShip : isConfiguredShip);

  const changed = await Promise.all(
    documents.map(document => setTokenRotationLock(document, locked))
  );

  return changed.filter(Boolean).length;
}

/** Keep a newly configured or assigned token consistent with battle state. */
export async function syncTokenRotationLock(tokenOrDocument, battleStarted) {
  const document = asTokenDocument(tokenOrDocument);
  if (!document || !game.user?.isGM) return false;

  const shouldLock = Boolean(battleStarted) && isDeployedBattleShip(document);
  return setTokenRotationLock(document, shouldLock);
}

export async function setSelectedShipRotationLock(locked) {
  if (!requireGM()) return false;

  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length !== 1) {
    ui.notifications.warn("Please select exactly one configured ship token.");
    return false;
  }

  const token = controlled[0];
  if (!getShipData(token)) {
    ui.notifications.warn(`${token.name} is not configured as a BFG ship.`);
    return false;
  }

  await setTokenRotationLock(token, locked);
  ui.notifications.info(
    `${token.name} rotation ${locked ? "locked" : "unlocked for Gamemaster correction"}.`
  );
  return true;
}

export const lockSelectedShipRotation = () => setSelectedShipRotationLock(true);
export const unlockSelectedShipRotation = () => setSelectedShipRotationLock(false);
