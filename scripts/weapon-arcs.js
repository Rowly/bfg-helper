import { ARC_PREFIX } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { applyTokenOverlayTransform } from "./token-rendering.js";

const overlays = new Map();
let ticker = null;
const ARC_FILL_COLOUR = 0xffaa00;
const ARC_LINE_COLOUR = 0xffcc66;

function pixelsPerCm() {
  const size = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  if (!(size > 0) || !(distance > 0)) throw new Error("Scene grid size and distance must be greater than zero.");
  return size / distance;
}

function identityFor(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  return {
    tokenId: document?.id ?? tokenOrDocument?.id ?? null,
    sceneId: document?.parent?.id ?? canvas.scene?.id ?? null
  };
}

function keyFor(tokenOrDocument) {
  const { sceneId, tokenId } = identityFor(tokenOrDocument);
  return `${sceneId}.${tokenId}`;
}

export function clearWeaponArc(tokenOrDocument) {
  const { tokenId } = identityFor(tokenOrDocument);
  const token = tokenOrDocument?.document
    ? tokenOrDocument
    : canvas.tokens?.get(tokenId) ?? null;
  const key = keyFor(tokenOrDocument);
  const entry = overlays.get(key);
  const graphics = entry?.graphics ?? token?._battlefleetWeaponArc;
  if (graphics && !graphics.destroyed) graphics.destroy({ children: true });
  overlays.delete(key);
  if (token) token._battlefleetWeaponArc = null;
}

export function clearAllWeaponArcs() {
  let count = 0;
  for (const child of [...canvas.tokens.children]) {
    if (typeof child.name === "string" && child.name.startsWith(ARC_PREFIX)) {
      if (!child.destroyed) child.destroy({ children: true });
      count += 1;
    }
  }
  overlays.clear();
  for (const token of canvas.tokens.placeables) token._battlefleetWeaponArc = null;
  ui.notifications.info(`Removed ${count} weapon arc${count === 1 ? "" : "s"}.`);
  return count;
}

export function drawWeaponArc(token, weapon) {
  clearWeaponArc(token);

  const scale = pixelsPerCm();
  const rangePixels = Number(weapon.rangeCm) * scale;
  const toRadians = Math.PI / 180;
  const direction = Number(weapon.directionDegrees) * toRadians;
  const halfArc = Number(weapon.arcDegrees) * toRadians / 2;

  const graphics = new PIXI.Graphics();
  graphics.name = `${ARC_PREFIX}${weapon.id ?? "weapon"}-${token.id}`;
  graphics.lineStyle(4, ARC_LINE_COLOUR, 0.9);
  graphics.beginFill(ARC_FILL_COLOUR, 0.2);
  graphics.moveTo(0, 0);
  graphics.arc(0, 0, rangePixels, direction - halfArc, direction + halfArc);
  graphics.lineTo(0, 0);
  graphics.closePath();
  graphics.endFill();
  applyTokenOverlayTransform(graphics, token);

  canvas.tokens.addChild(graphics);
  overlays.set(keyFor(token), {
    graphics,
    tokenId: token.id,
    sceneId: canvas.scene.id
  });
  token._battlefleetWeaponArc = graphics;
  return graphics;
}

/** Keep enabled arcs attached to their ships throughout canvas animations. */
export function initialiseWeaponArcTicker() {
  if (ticker) canvas.app.ticker.remove(ticker);

  ticker = () => {
    for (const [key, entry] of overlays.entries()) {
      if (entry.sceneId !== canvas.scene?.id || entry.graphics.destroyed) {
        if (!entry.graphics.destroyed) entry.graphics.destroy({ children: true });
        overlays.delete(key);
        continue;
      }

      const token = canvas.tokens.get(entry.tokenId);
      if (!token) {
        if (!entry.graphics.destroyed) entry.graphics.destroy({ children: true });
        overlays.delete(key);
        continue;
      }

      applyTokenOverlayTransform(entry.graphics, token);
    }
  };

  canvas.app.ticker.add(ticker);
}

export async function toggleWeaponDialog(token = canvas.tokens.controlled[0]) {
  if (!token) {
    ui.notifications.warn("Please select a ship token.");
    return;
  }

  const key = keyFor(token);
  if (overlays.has(key) || token._battlefleetWeaponArc) {
    clearWeaponArc(token);
    ui.notifications.info("Weapon arc hidden.");
    return;
  }

  const shipData = getShipData(token.actor);
  if (!shipData?.weapons?.length) {
    ui.notifications.error(`${token.name} has no configured weapons.`);
    return;
  }

  const options = shipData.weapons.map((weapon, index) => {
    const name = foundry.utils.escapeHTML(String(weapon.name));
    return `<option value="${index}">${name} - ${weapon.rangeCm} cm - ${weapon.arcDegrees} degrees</option>`;
  }).join("");

  const result = await foundry.applications.api.DialogV2.input({
    window: { title: `${shipData.shipClass ?? token.name}: Weapon Arc` },
    content: `<div class="bfg-dialog"><label><strong>Weapon system</strong></label><select name="weaponIndex">${options}</select></div>`,
    ok: { label: "Show Weapon Arc", icon: "fa-solid fa-crosshairs" },
    rejectClose: false,
    modal: true
  });

  if (!result) return;
  const weapon = shipData.weapons[Number(result.weaponIndex)];
  if (!weapon) return ui.notifications.error("Invalid weapon selection.");
  drawWeaponArc(token, weapon);
  ui.notifications.info(`${weapon.name}: ${weapon.rangeCm} cm.`);
}
