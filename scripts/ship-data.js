import { MODULE_ID, FLAG_KEY } from "./constants.js";

/* --------------------------------------------------------- */
/* SHIP DATA ACCESS                                          */
/* --------------------------------------------------------- */

export function getBaseActor(actorOrToken) {
  if (!actorOrToken) return null;

  /*
   * A placed Token may be unlinked. In that case token.actor is a synthetic
   * Actor/ActorDelta and flags written to it are not present on game.actors.
   * Ship configuration belongs to the source Actor, so resolve that Actor
   * whenever possible.
   */
  const tokenDocument = actorOrToken.document?.documentName === "Token"
    ? actorOrToken.document
    : actorOrToken.documentName === "Token"
      ? actorOrToken
      : null;

  if (tokenDocument?.actorId) {
    return game.actors?.get(tokenDocument.actorId) ?? actorOrToken.actor ?? null;
  }

  const actor = actorOrToken.actor ?? actorOrToken;
  if (!actor) return null;

  if (actor.isToken) {
    const actorId = actor.token?.actorId ?? actor.id;
    return game.actors?.get(actorId) ?? actor;
  }

  return game.actors?.get(actor.id) ?? actor;
}

export function getShipData(actorOrToken) {
  const actor = getBaseActor(actorOrToken);
  return actor?.getFlag(MODULE_ID, FLAG_KEY) ?? null;
}

export async function setShipData(actorOrToken, data) {
  const actor = getBaseActor(actorOrToken);
  if (!actor) throw new Error("No Actor supplied.");
  validateShipData(data);
  return actor.setFlag(MODULE_ID, FLAG_KEY, data);
}

/* --------------------------------------------------------- */
/* SHIP DATA VALIDATION                                      */
/* --------------------------------------------------------- */

export function validateShipData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Ship data must be an object.");
  }

  if (!Array.isArray(data.weapons)) {
    throw new Error("Ship data must contain a weapons array.");
  }

  for (const weapon of data.weapons) {
    if (!weapon?.name) throw new Error("Every weapon requires a name.");

    if (!(Number(weapon.rangeCm) > 0)) {
      throw new Error(`${weapon.name} has an invalid range.`);
    }

    if (!Number.isFinite(Number(weapon.directionDegrees))) {
      throw new Error(`${weapon.name} has an invalid direction.`);
    }

    const arc = Number(weapon.arcDegrees);
    if (!(arc > 0 && arc <= 360)) {
      throw new Error(`${weapon.name} has an invalid arc.`);
    }
  }

  return true;
}

/* --------------------------------------------------------- */
/* CONFIGURE THE SELECTED SHIP                               */
/* --------------------------------------------------------- */

export async function configureSelectedShip(profileData) {
  const controlled = canvas.tokens.controlled;

  if (controlled.length !== 1) {
    ui.notifications.warn("Please select exactly one ship token.");
    return false;
  }

  const token = controlled[0];
  const actor = getBaseActor(token);

  if (!actor) {
    ui.notifications.error("The selected token has no associated Actor.");
    return false;
  }

  validateShipData(profileData);

  /*
   * The Actor stores reusable ship-class/profile data only. Fleet membership
   * belongs to each deployed TokenDocument and is deliberately not copied
   * into the profile. This allows several ships of the same class to exist as
   * independent fleet members.
   */
  const data = foundry.utils.deepClone(profileData);
  delete data.fleetId;
  delete data.fleetName;

  await setShipData(actor, data);

  const width = Number(data.tokenSize?.width ?? token.document.width);
  const height = Number(data.tokenSize?.height ?? token.document.height);

  const anchorX = Number(
    data.tokenTexture?.anchorX ?? token.document.texture?.anchorX ?? 0.5
  );
  const anchorY = Number(
    data.tokenTexture?.anchorY ?? token.document.texture?.anchorY ?? 0.5
  );
  const scaleX = Number(
    data.tokenTexture?.scaleX ?? token.document.texture?.scaleX ?? 1
  );
  const scaleY = Number(
    data.tokenTexture?.scaleY ?? token.document.texture?.scaleY ?? 1
  );
  const fit = String(
    data.tokenTexture?.fit ?? token.document.texture?.fit ?? "contain"
  );

  await actor.update({
    "prototypeToken.width": width,
    "prototypeToken.height": height,
    "prototypeToken.lockRotation": false,
    "prototypeToken.texture.anchorX": anchorX,
    "prototypeToken.texture.anchorY": anchorY,
    "prototypeToken.texture.scaleX": scaleX,
    "prototypeToken.texture.scaleY": scaleY,
    "prototypeToken.texture.fit": fit
  });

  await token.document.update({
    width,
    height,
    lockRotation: false,
    "texture.anchorX": anchorX,
    "texture.anchorY": anchorY,
    "texture.scaleX": scaleX,
    "texture.scaleY": scaleY,
    "texture.fit": fit
  });

  ui.notifications.info(`${data.shipClass ?? actor.name} configured.`);
  return true;
}
