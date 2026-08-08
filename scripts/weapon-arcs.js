import { ARC_PREFIX } from "./constants.js";
import { getShipData } from "./ship-data.js";

const overlays = new Map();

function pixelsPerCm() {
  const size = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  if (!(size > 0) || !(distance > 0)) throw new Error("Scene grid size and distance must be greater than zero.");
  return size / distance;
}

function keyFor(token) {
  return `${canvas.scene.id}.${token.id}`;
}

export function clearWeaponArc(token) {
  const key = keyFor(token);
  const graphics = overlays.get(key) ?? token._battlefleetWeaponArc;
  if (graphics && !graphics.destroyed) graphics.destroy({ children: true });
  overlays.delete(key);
  token._battlefleetWeaponArc = null;
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
  graphics.lineStyle(4, Number(weapon.lineColour ?? 0xff6666), 0.9);
  graphics.beginFill(Number(weapon.fillColour ?? 0xff0000), 0.2);
  graphics.moveTo(0, 0);
  graphics.arc(0, 0, rangePixels, direction - halfArc, direction + halfArc);
  graphics.lineTo(0, 0);
  graphics.closePath();
  graphics.endFill();
  graphics.position.set(token.center.x, token.center.y);
  graphics.rotation = Number(token.document.rotation) * toRadians;

  canvas.tokens.addChild(graphics);
  overlays.set(keyFor(token), graphics);
  token._battlefleetWeaponArc = graphics;
  return graphics;
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
    return `<option value="${index}">${name} — ${weapon.rangeCm} cm — ${weapon.arcDegrees}°</option>`;
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
