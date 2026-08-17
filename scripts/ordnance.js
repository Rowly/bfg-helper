import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { getCombatState, halveRoundedUp } from "./combat-state.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { canUserControlToken, requireUserCanControlToken } from "./fleet-control.js";
import { getActingFleetIndex, getTurnState } from "./turn-manager.js";
import { publishBFGDice } from "./dice.js";
import { getBoardingState, hasDeclaredBoarding } from "./boarding.js";
import { effectiveOrdnanceStrength } from "./special-orders.js";

export const ORDNANCE_MARKER_FLAG = "ordnanceMarker";
export const ORDNANCE_STATE_FLAG = "ordnanceState";
const ORDNANCE_PREVIEW_NAME = "bfg-ordnance-movement-preview";
const ORDNANCE_TRAIL_PREFIX = "bfg-ordnance-trail-";
const ORDNANCE_SOCKET = `module.${MODULE_ID}`;
let ordnanceControlsInitialised = false;
const blastMarkerChoices = new Map();
const pendingAttackCraftDrags = new Map();
const pendingCAPShipMoves = new Map();
const ATTACK_CRAFT_IMAGES = Object.freeze({
  swiftdeath: "modules/bfg-helper/assets/chaos-fighter-craft.svg",
  doomfire: "modules/bfg-helper/assets/chaos-bomber-craft.svg",
  fighter: "modules/bfg-helper/assets/attack-craft-fighters.svg",
  bomber: "modules/bfg-helper/assets/attack-craft-bombers.svg",
  "assault-boat": "modules/bfg-helper/assets/attack-craft-boarding.svg"
});

function attackCraftImage(craft) {
  return ATTACK_CRAFT_IMAGES[craft?.craftId]
    ?? ATTACK_CRAFT_IMAGES[craft?.id]
    ?? ATTACK_CRAFT_IMAGES[craft?.role]
    ?? ATTACK_CRAFT_IMAGES.fighter;
}

export async function refreshAttackCraftArtwork() {
  if (!game.user?.isGM) return false;
  for (const actor of game.actors ?? []) {
    const craftId = actor.getFlag(MODULE_ID, "ordnanceActorType");
    if (!craftId || craftId === "torpedo-salvo") continue;
    const craft = [
      { id: "swiftdeath", role: "fighter" },
      { id: "doomfire", role: "bomber" },
      { id: "dreadclaw", role: "assault-boat" }
    ].find(item => item.id === craftId) ?? {
      id: craftId,
      role: actor.getFlag(MODULE_ID, "ordnanceRole")
    };
    if (!craft.role) continue;
    const image = attackCraftImage(craft);
    await actor.update({
      img: image,
      "prototypeToken.width": 2,
      "prototypeToken.height": 2,
      "prototypeToken.texture.src": image,
      "prototypeToken.texture.fit": "contain"
    });
  }
  for (const token of canvas.tokens?.placeables ?? []) {
    const marker = getOrdnanceMarker(token);
    if (marker?.category !== "attackCraft") continue;
    const image = attackCraftImage(marker);
    await token.document.update({
      width: 2,
      height: 2,
      "texture.src": image,
      "texture.fit": "contain"
    });
  }
  return true;
}

export function initialiseOrdnanceControls() {
  if (ordnanceControlsInitialised) return;
  ordnanceControlsInitialised = true;

  game.socket?.on(ORDNANCE_SOCKET, message => {
    if (message?.event !== "ordnance-canvas" || message.senderId === game.user?.id) return;
    if (!canvas?.ready || message.sceneId !== canvas.scene?.id) return;
    if (message.action === "trail") {
      drawOrdnanceTrail(message.data.start, message.data.destination, message.data.widthPixels, {
        colour: message.data.colour,
        broadcast: false
      });
    } else if (message.action === "clear-trails") {
      clearAllOrdnanceTrails({ notify: false, broadcast: false });
    } else if (message.action === "refresh-tokens") {
      const pending = new Set(message.data.tokenIds ?? []);
      let attempts = 0;
      const refresh = () => {
        attempts += 1;
        for (const id of [...pending]) {
          const token = canvas.tokens?.get(id);
          if (!token) continue;
          token.renderFlags?.set?.({ refresh: true, refreshMesh: true });
          pending.delete(id);
        }
        if (pending.size && attempts < 10) window.setTimeout(refresh, 200);
      };
      window.setTimeout(refresh, 100);
    }
  });

  document.addEventListener("pointerdown", event => {
    const dial = event.target?.closest?.(".bfg-bearing-dial");
    if (!dial) return;
    event.preventDefault();

    const bounds = dial.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const bearing = Math.round((Math.atan2(x, -y) * 180 / Math.PI + 360) % 360);
    const arcCentre = Number(dial.dataset.arcCentre);
    const arcHalf = Number(dial.dataset.arcHalf);
    if (Number.isFinite(arcCentre) && Number.isFinite(arcHalf)) {
      let difference = bearing - arcCentre;
      if (difference > 180) difference -= 360;
      if (difference <= -180) difference += 360;
      if (Math.abs(difference) > arcHalf + 0.000001) return;
    }
    const input = dial.querySelector('input[name="rotation"]');
    const needle = dial.querySelector(".bfg-bearing-needle");
    const output = dial.querySelector("output");

    if (input) {
      input.value = String(bearing);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (needle) needle.style.transform = `translateX(-50%) rotate(${bearing}deg)`;
    if (output) output.value = `${bearing} degrees`;
  });

  document.addEventListener("change", event => {
    const checkbox = event.target?.closest?.(".bfg-ordnance-blast-choice");
    if (!checkbox) return;
    blastMarkerChoices.set(checkbox.dataset.tokenId, checkbox.checked);
  });

  document.addEventListener("input", event => {
    const slider = event.target?.closest?.(".bfg-ordnance-distance-slider");
    if (!slider) return;
    const output = slider.nextElementSibling;
    if (output?.tagName === "OUTPUT") output.value = `${slider.value} cm`;
  });
}

function emitOrdnanceCanvas(action, data = {}) {
  game.socket?.emit(ORDNANCE_SOCKET, {
    event: "ordnance-canvas",
    action,
    data,
    sceneId: canvas?.scene?.id ?? null,
    senderId: game.user?.id ?? null
  });
}

export function refreshSharedOrdnanceTokens(tokenIds) {
  emitOrdnanceCanvas("refresh-tokens", { tokenIds: [...tokenIds] });
}

function selectedToken() {
  const selected = canvas.tokens?.controlled ?? [];
  if (selected.length !== 1) {
    ui.notifications.warn("Please select exactly one ship or ordnance marker.");
    return null;
  }
  return selected[0];
}

function activationKey(state = getTurnState()) {
  const actingFleetIndex = getActingFleetIndex(state);
  return `${state.battleId ?? "no-battle"}:${state.round}:${state.activeFleetIndex}:${state.phase}:${actingFleetIndex}`;
}

export function getOrdnanceMarker(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  return document?.getFlag?.(MODULE_ID, ORDNANCE_MARKER_FLAG) ?? null;
}

export function getOrdnanceState(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  const stored = document?.getFlag?.(MODULE_ID, ORDNANCE_STATE_FLAG) ?? {};
  return {
    attackCraftLoaded: stored.attackCraftLoaded !== false,
    torpedoesLoaded: stored.torpedoesLoaded !== false
  };
}

function effectiveBayCapacity(shipData, combatState, token = null) {
  const total = (shipData?.ordnance ?? []).reduce(
    (sum, bay) => sum + Math.max(0, Number(bay.capacity) || 0), 0
  );
  return token ? effectiveOrdnanceStrength(token, total) : combatState?.crippled ? halveRoundedUp(total) : total;
}

function fleetAttackCraftInPlay(fleetId) {
  return (canvas.tokens?.placeables ?? []).filter(token => {
    const marker = getOrdnanceMarker(token);
    return marker?.category === "attackCraft" && marker.fleetId === fleetId;
  }).length;
}

function fleetLaunchBayLimit(fleetId) {
  return (canvas.tokens?.placeables ?? []).reduce((sum, token) => {
    if (getTokenFleetId(token) !== fleetId) return sum;
    const combat = getCombatState(token);
    if (!combat || combat.outOfAction) return sum;
    return sum + effectiveBayCapacity(getShipData(token), combat, token);
  }, 0);
}

function launchErrors(token, state, fleetId) {
  const errors = [];
  if (!canUserControlToken(token, game.user, state)) errors.push(`You are not assigned to control ${token.name}.`);
  const combat = getCombatState(token);
  if (!state.battleStarted) errors.push("No battle is in progress.");
  if (state.phase !== "shooting") errors.push("Attack craft are launched at the end of the Shooting phase.");
  if (!fleetId) errors.push(`${token.name} is not assigned to a fleet.`);
  const activeFleet = state.fleets?.[state.activeFleetIndex];
  if (fleetId && activeFleet?.id !== fleetId) errors.push(`${token.name} does not belong to the active fleet.`);
  if (combat?.outOfAction) errors.push(`${token.name} is out of action.`);
  if (hasDeclaredBoarding(token) || getBoardingState(token)?.drawn) errors.push(`${token.name} is committed to a boarding action.`);
  return errors;
}

async function confirmGMOverride(errors, title) {
  if (!errors.length) return true;
  if (!game.user?.isGM) throw new Error(errors.join(" "));
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>${errors.map(error => foundry.utils.escapeHTML(error)).join(" ")}</p><p>Continue as a Gamemaster testing/correction override?</p>`,
    yes: { label: "Continue Override", icon: "fa-solid fa-unlock" },
    no: { label: "Cancel" },
    rejectClose: false,
    modal: true
  });
}

function actorType() {
  return game.system?.documentTypes?.Actor?.[0] ?? "base";
}

async function getOrCreateMarkerActor(craft) {
  const existing = game.actors?.find(actor =>
    actor.getFlag(MODULE_ID, "ordnanceActorType") === craft.id
  );
  if (existing) {
    if (game.user?.isGM) {
      const image = attackCraftImage(craft);
      await existing.update({
        img: image,
        "prototypeToken.width": 2,
        "prototypeToken.height": 2,
        "prototypeToken.texture.src": image,
        "prototypeToken.texture.fit": "contain",
        [`flags.${MODULE_ID}.ordnanceRole`]: craft.role
      });
    }
    return existing;
  }

  if (!game.user?.isGM) {
    throw new Error(`A Gamemaster must create the ${craft.name} marker Actor before players can launch it.`);
  }

  const actor = await Actor.create({
    name: craft.name,
    type: actorType(),
    img: attackCraftImage(craft),
    prototypeToken: {
      name: craft.name,
      width: 2,
      height: 2,
      texture: { src: attackCraftImage(craft), fit: "contain" },
      disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      lockRotation: false
    },
    flags: { [MODULE_ID]: { ordnanceActorType: craft.id, ordnanceRole: craft.role } }
  }, { renderSheet: false });
  return actor;
}

function launchPosition(ship, index, total) {
  const grid = Number(canvas.scene?.grid?.size ?? 100);
  const columns = Math.min(4, total);
  const rows = Math.ceil(total / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const lateral = (column - (columns - 1) / 2) * grid * 2;
  const stern = (Number(ship.h) / 2) + grid + (rows - 1 - row) * grid * 2;
  const radians = Number(ship.document.rotation ?? 0) * Math.PI / 180;
  const right = { x: Math.cos(radians), y: Math.sin(radians) };
  const backward = { x: -Math.sin(radians), y: Math.cos(radians) };
  return {
    x: Number(ship.center.x) + right.x * lateral + backward.x * stern - grid,
    y: Number(ship.center.y) + right.y * lateral + backward.y * stern - grid
  };
}

export async function launchSelectedShipAttackCraft() {
  const ship = selectedToken();
  if (!ship) return false;
  const shipData = getShipData(ship);
  const craft = shipData?.attackCraft ?? [];
  if (!craft.length) {
    ui.notifications.warn(`${ship.name} has no configured attack craft.`);
    return false;
  }

  const state = getTurnState();
  const fleetId = getTokenFleetId(ship);
  if (!await confirmGMOverride(launchErrors(ship, state, fleetId), "Override Ordnance Launch Restriction?")) return false;

  const ordnanceState = getOrdnanceState(ship);
  if (!ordnanceState.attackCraftLoaded) {
    ui.notifications.warn(`${ship.name}'s attack craft must be reloaded before launching again.`);
    return false;
  }

  const shipCapacity = effectiveBayCapacity(shipData, getCombatState(ship), ship);
  const fleetLimit = fleetLaunchBayLimit(fleetId);
  const inPlay = fleetAttackCraftInPlay(fleetId);
  const available = Math.max(0, Math.min(shipCapacity, fleetLimit - inPlay));
  if (!available) {
    ui.notifications.warn(`The fleet attack-craft limit is reached (${inPlay}/${fleetLimit}).`);
    return false;
  }

  const fields = craft.map(item => `
    <label>${foundry.utils.escapeHTML(item.name)} (${item.speedCm} cm)</label>
    <div class="bfg-quantity-stepper" data-bfg-stepper>
      <button type="button" data-bfg-step="-1" aria-label="Remove one ${foundry.utils.escapeHTML(item.name)}"><i class="fa-solid fa-minus"></i></button>
      <input type="number" name="${item.id}" value="0" min="0" max="${available}" step="1" readonly aria-label="${foundry.utils.escapeHTML(item.name)} squadrons">
      <button type="button" data-bfg-step="1" aria-label="Add one ${foundry.utils.escapeHTML(item.name)}"><i class="fa-solid fa-plus"></i></button>
    </div>`
  ).join("");
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: `Launch Attack Craft: ${ship.name}` },
    content: `<div class="bfg-dialog" data-bfg-step-group data-bfg-step-group-max="${available}"><p>Launch up to ${available} squadron markers. Any amount expends this ship's loaded attack craft.</p>${fields}</div>`,
    ok: { label: "Launch", icon: "fa-solid fa-jet-fighter-up" },
    rejectClose: false,
    modal: true
  });
  if (!result) return false;

  const selections = craft.flatMap(item => Array.from(
    { length: Math.max(0, Math.trunc(Number(result[item.id]) || 0)) }, () => item
  ));
  if (!selections.length) {
    ui.notifications.warn("Choose at least one attack craft squadron to launch.");
    return false;
  }
  if (selections.length > available) {
    ui.notifications.warn(`This launch is limited to ${available} squadron markers.`);
    return false;
  }

  const waveId = foundry.utils.randomID();
  const tokenData = [];
  for (const [index, item] of selections.entries()) {
    const actor = await getOrCreateMarkerActor(item);
    const position = launchPosition(ship, index, selections.length);
    const data = await actor.getTokenDocument({
      ...position,
      rotation: ship.document.rotation,
      actorLink: false,
      disposition: ship.document.disposition,
      flags: {
        [MODULE_ID]: {
          [ORDNANCE_MARKER_FLAG]: {
            category: "attackCraft",
            craftId: item.id,
            name: item.name,
            role: item.role,
            speedCm: item.speedCm,
            fleetId,
            sourceTokenId: ship.document.id,
            waveId,
            launchedRound: state.round,
            launchedActivation: activationKey(state)
          }
        }
      }
    });
    tokenData.push(tokenDataFromDocument(data));
  }

  const created = await canvas.scene.createEmbeddedDocuments("Token", tokenData);
  refreshSharedOrdnanceTokens(created.map(document => document.id));
  await ship.document.setFlag(MODULE_ID, ORDNANCE_STATE_FLAG, {
    ...ordnanceState,
    attackCraftLoaded: false
  });
  ui.notifications.info(`${ship.name} launched ${selections.length} attack craft squadron${selections.length === 1 ? "" : "s"}.`);
  return true;
}

function tokenDataFromDocument(document) {
  return typeof document.toObject === "function" ? document.toObject() : document;
}

function pixelsPerCm() {
  const size = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  if (!(size > 0) || !(distance > 0)) throw new Error("The Scene requires a valid grid scale.");
  return size / distance;
}

export function clearOrdnanceMovementPreview() {
  const preview = globalThis.bfgOrdnanceMovementPreview;
  if (preview && !preview.destroyed) preview.destroy({ children: true });
  globalThis.bfgOrdnanceMovementPreview = null;
}

function attackCraftDragActivationKey(state = getTurnState()) {
  return `${state.battleId ?? "no-battle"}:${state.round}:${state.activeFleetIndex}:ordnance:${getActingFleetIndex(state)}`;
}

/** Validate and orient ordinary canvas drag movement for attack-craft markers. */
export function validateAttackCraftDrag(tokenDocument, changes, _options, userId) {
  if (_options?.bfgWaveMove) return;
  if (userId !== game.user?.id) return;
  const marker = getOrdnanceMarker(tokenDocument);
  if (marker?.category !== "attackCraft") return;
  if (changes.x === undefined && changes.y === undefined) return;

  const from = { x: Number(tokenDocument.x), y: Number(tokenDocument.y) };
  const to = {
    x: Number(changes.x ?? tokenDocument.x),
    y: Number(changes.y ?? tokenDocument.y)
  };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distancePixels = Math.hypot(dx, dy);
  if (!(distancePixels > 0)) return;

  const state = getTurnState();
  if (state.battleStarted) {
    const activeFleet = state.fleets?.[getActingFleetIndex(state)];
    const error = marker.capShipId
      ? `${tokenDocument.name} is on Combat Air Patrol and cannot move independently.`
      : state.phase !== "ordnance"
      ? "Attack craft can only move during the Ordnance phase."
      : activeFleet?.id !== marker.fleetId
        ? `${tokenDocument.name} does not belong to the active fleet.`
        : marker.lastMovedActivation === attackCraftDragActivationKey(state)
          ? `${tokenDocument.name} has already moved this Ordnance phase.`
          : null;
    if (error) {
      ui.notifications.warn(error);
      return false;
    }
  }

  const maximumCm = Number(marker.speedCm);
  const maximumPixels = maximumCm * pixelsPerCm();
  if (distancePixels > maximumPixels + 0.01) {
    ui.notifications.warn(`${tokenDocument.name} may move a maximum of ${maximumCm} cm.`);
    return false;
  }

  changes.rotation = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  pendingAttackCraftDrags.set(tokenDocument.id, { dx, dy, rotation: changes.rotation });
}

/** Record a completed attack-craft drag and resolve its manual Blast Marker test. */
export async function completeAttackCraftDrag(tokenDocument, changes, _options, userId) {
  if (_options?.bfgWaveMove) return;
  if (userId !== game.user?.id) return;
  const marker = getOrdnanceMarker(tokenDocument);
  if (marker?.category !== "attackCraft") return;
  if (changes.x === undefined && changes.y === undefined) return;
  const drag = pendingAttackCraftDrags.get(tokenDocument.id);
  pendingAttackCraftDrags.delete(tokenDocument.id);
  if (!drag) return;

  const state = getTurnState();
  const activation = attackCraftDragActivationKey(state);
  await tokenDocument.update({
    [`flags.${MODULE_ID}.${ORDNANCE_MARKER_FLAG}.waveId`]: foundry.utils.randomID(),
    [`flags.${MODULE_ID}.${ORDNANCE_MARKER_FLAG}.lastMovedActivation`]: state.battleStarted ? activation : null
  }, { bfgWaveMove: true });

  const throughBlastMarker = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Attack Craft Movement: ${tokenDocument.name}` },
    content: "<p>Did this attack-craft marker move through one or more Blast Markers?</p>",
    yes: { label: "Yes: Roll Test", icon: "fa-solid fa-burst" },
    no: { label: "No", icon: "fa-solid fa-check" },
    rejectClose: false,
    modal: false
  });
  if (!throughBlastMarker) return;

  const roll = await new Roll("1d6").evaluate();
  await publishBFGDice(roll, {
    speaker: ChatMessage.getSpeaker({ token: tokenDocument }),
    flavor: `${tokenDocument.name}: Attack craft passing through Blast Markers`
  });
  if (roll.total === 6) {
    await tokenDocument.delete();
    ui.notifications.warn(`${tokenDocument.name} was destroyed by the Blast Markers.`);
  }
}

export function captureCAPShipMovement(tokenDocument, changes) {
  if (!getShipData(tokenDocument)) return;
  if (changes.x === undefined && changes.y === undefined && changes.rotation === undefined) return;
  const token = canvas.tokens?.get(tokenDocument.id);
  if (!token) return;
  pendingCAPShipMoves.set(tokenDocument.id, {
    center: { x: Number(token.center.x), y: Number(token.center.y) },
    rotation: Number(tokenDocument.rotation ?? 0)
  });
}

export async function completeCAPShipMovement(tokenDocument, changes) {
  if (changes.x === undefined && changes.y === undefined && changes.rotation === undefined) return;
  const before = pendingCAPShipMoves.get(tokenDocument.id);
  pendingCAPShipMoves.delete(tokenDocument.id);
  if (!before) return;
  const ship = canvas.tokens?.get(tokenDocument.id);
  if (!ship) return;
  const rotationChange = (Number(tokenDocument.rotation ?? 0) - before.rotation) * Math.PI / 180;
  const cosine = Math.cos(rotationChange);
  const sine = Math.sin(rotationChange);
  const cap = (canvas.tokens?.placeables ?? []).filter(token =>
    getOrdnanceMarker(token)?.capShipId === tokenDocument.id
  );
  for (const fighter of cap) {
    const relativeX = fighter.center.x - before.center.x;
    const relativeY = fighter.center.y - before.center.y;
    const rotatedX = relativeX * cosine - relativeY * sine;
    const rotatedY = relativeX * sine + relativeY * cosine;
    await fighter.document.update({
      x: ship.center.x + rotatedX - fighter.w / 2,
      y: ship.center.y + rotatedY - fighter.h / 2,
      rotation: Number(fighter.document.rotation ?? 0) + rotationChange * 180 / Math.PI
    }, { bfgWaveMove: true });
  }
}

export function drawOrdnanceTrail(start, destination, widthPixels, { colour = 0xffcc66, broadcast = true } = {}) {
  if (!canvas?.ready || !canvas.tokens) return null;
  const dx = Number(destination.x) - Number(start.x);
  const dy = Number(destination.y) - Number(start.y);
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return null;
  const halfWidth = Math.max(1, Number(widthPixels) / 2);
  const offsetX = -dy / length * halfWidth;
  const offsetY = dx / length * halfWidth;
  const grid = Number(canvas.scene?.grid?.size ?? 100);
  const graphics = new PIXI.Graphics();
  graphics.name = `${ORDNANCE_TRAIL_PREFIX}${foundry.utils.randomID()}`;
  graphics.beginFill(colour, 0.10);
  graphics.drawPolygon([
    start.x + offsetX, start.y + offsetY,
    destination.x + offsetX, destination.y + offsetY,
    destination.x - offsetX, destination.y - offsetY,
    start.x - offsetX, start.y - offsetY
  ]);
  graphics.endFill();
  graphics.lineStyle(Math.max(2, grid * 0.035), colour, 0.55);
  graphics.moveTo(start.x, start.y);
  graphics.lineTo(destination.x, destination.y);
  canvas.tokens.addChildAt(graphics, 0);
  if (broadcast) emitOrdnanceCanvas("trail", { start, destination, widthPixels, colour });
  return graphics;
}

export function clearAllOrdnanceTrails({ notify = true, broadcast = true } = {}) {
  let count = 0;
  for (const child of [...(canvas.tokens?.children ?? [])]) {
    if (!String(child?.name ?? "").startsWith(ORDNANCE_TRAIL_PREFIX)) continue;
    child.destroy({ children: true });
    count += 1;
  }
  if (notify) ui.notifications.info(`Cleared ${count} ordnance path${count === 1 ? "" : "s"}.`);
  if (broadcast) emitOrdnanceCanvas("clear-trails");
  return count;
}

function ordnanceDestination(token, distanceCm, rotation) {
  const radians = rotation * Math.PI / 180;
  const distancePixels = distanceCm * pixelsPerCm();
  return {
    x: token.center.x + Math.sin(radians) * distancePixels,
    y: token.center.y - Math.cos(radians) * distancePixels
  };
}

function drawOrdnanceMovementPreview(token, distanceCm, rotation) {
  clearOrdnanceMovementPreview();
  const destination = ordnanceDestination(token, distanceCm, rotation);
  const grid = Number(canvas.scene?.grid?.size ?? 100);
  const graphics = new PIXI.Graphics();
  graphics.name = `${ORDNANCE_PREVIEW_NAME}-${token.document.id}`;

  const dx = destination.x - token.center.x;
  const dy = destination.y - token.center.y;
  const length = Math.hypot(dx, dy);
  const halfWidth = Number(token.w) / 2;
  if (length > 0) {
    const offsetX = -dy / length * halfWidth;
    const offsetY = dx / length * halfWidth;
    graphics.beginFill(0xffcc66, 0.16);
    graphics.drawPolygon([
      token.center.x + offsetX, token.center.y + offsetY,
      destination.x + offsetX, destination.y + offsetY,
      destination.x - offsetX, destination.y - offsetY,
      token.center.x - offsetX, token.center.y - offsetY
    ]);
    graphics.endFill();
  }

  graphics.lineStyle(Math.max(4, grid * 0.06), 0xffcc66, 0.95);
  graphics.moveTo(token.center.x, token.center.y);
  graphics.lineTo(destination.x, destination.y);

  const angle = (rotation - 90) * Math.PI / 180;
  const arrowSize = Math.max(12, grid * 0.22);
  for (const offset of [150, -150]) {
    const arrowAngle = angle + offset * Math.PI / 180;
    graphics.moveTo(destination.x, destination.y);
    graphics.lineTo(
      destination.x + Math.cos(arrowAngle) * arrowSize,
      destination.y + Math.sin(arrowAngle) * arrowSize
    );
  }

  graphics.beginFill(0xffcc66, 0.14);
  graphics.lineStyle(Math.max(3, grid * 0.04), 0xffcc66, 0.9);
  graphics.drawCircle(destination.x, destination.y, Math.min(token.w, token.h) / 2);
  graphics.endFill();
  canvas.tokens.addChild(graphics);
  globalThis.bfgOrdnanceMovementPreview = graphics;
  return destination;
}

export async function moveSelectedOrdnance() {
  const token = selectedToken();
  if (!token) return false;
  if (!requireUserCanControlToken(token, "move this ordnance")) return false;
  const marker = getOrdnanceMarker(token);
  if (!marker) {
    ui.notifications.warn(`${token.name} is not a BFG ordnance marker.`);
    return false;
  }
  if (marker.category === "attackCraft") {
    ui.notifications.info(`${token.name} uses normal click-drag movement up to ${marker.speedCm} cm.`);
    return false;
  }

  const state = getTurnState();
  const errors = [];
  if (!state.battleStarted) errors.push("No battle is in progress.");
  if (state.phase !== "ordnance") errors.push("The current phase is not Ordnance.");
  const activeFleet = state.fleets?.[getActingFleetIndex(state)];
  if (activeFleet?.id !== marker.fleetId) errors.push(`${token.name} does not belong to the active fleet.`);
  if (marker.lastMovedActivation === activationKey(state)) errors.push(`${token.name} has already moved in this Ordnance phase.`);
  if (!await confirmGMOverride(errors, "Override Ordnance Movement Restriction?")) return false;

  let result;
  const isTorpedo = marker.category === "torpedo";
  let plannedDistanceCm = Number(marker.speedCm);
  let plannedRotation = Number(token.document.rotation ?? 0);
  let throughBlastMarker = false;
  while (true) {
    const torpedoFields = `<p><strong>Standard torpedoes must move their full ${marker.speedCm} cm straight ahead.</strong></p>
      <input type="hidden" name="distanceCm" value="${marker.speedCm}">
      <input type="hidden" name="rotation" value="${token.document.rotation}">`;
    const attackCraftFields = `<label>Distance (cm)</label><input type="range" class="bfg-ordnance-distance-slider" name="distanceCm" value="${plannedDistanceCm}" min="0" max="${marker.speedCm}" step="0.5"><output>${plannedDistanceCm} cm</output>
        <label>Bearing</label>
        <div class="bfg-bearing-dial" title="Click the compass to choose a bearing">
          <span class="bfg-bearing-cardinal north">0 degrees</span>
          <span class="bfg-bearing-cardinal east">90 degrees</span>
          <span class="bfg-bearing-cardinal south">180 degrees</span>
          <span class="bfg-bearing-cardinal west">270 degrees</span>
          <span class="bfg-bearing-needle" style="transform: translateX(-50%) rotate(${plannedRotation}deg)"></span>
          <span class="bfg-bearing-centre"></span>
          <input type="hidden" name="rotation" value="${plannedRotation}">
          <output>${plannedRotation} degrees</output>
        </div>
        <small>Click toward the desired direction of travel.</small>`;
    result = await foundry.applications.api.DialogV2.input({
      window: { title: `Plan Ordnance Move: ${token.name}` },
      content: `<div class="bfg-dialog">
        <p>${foundry.utils.escapeHTML(marker.name)} ${isTorpedo ? "follows a fixed torpedo course." : `may move up to ${marker.speedCm} cm in any direction.`}</p>
        ${isTorpedo ? torpedoFields : attackCraftFields}
      </div>`,
      ok: { label: "Preview Vector", icon: "fa-solid fa-route" },
      rejectClose: false,
      modal: true
    });
    if (!result) {
      clearOrdnanceMovementPreview();
      return false;
    }

    plannedDistanceCm = isTorpedo ? Number(marker.speedCm) : Number(result.distanceCm);
    plannedRotation = isTorpedo ? Number(token.document.rotation ?? 0) : Number(result.rotation);
    if (!Number.isFinite(plannedDistanceCm) || plannedDistanceCm < 0 || plannedDistanceCm > Number(marker.speedCm)) {
      ui.notifications.warn(`Movement must be between 0 and ${marker.speedCm} cm.`);
      continue;
    }
    drawOrdnanceMovementPreview(token, plannedDistanceCm, plannedRotation);
    blastMarkerChoices.set(token.document.id, throughBlastMarker);
    const execute = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Execute Ordnance Move?" },
      content: `<div class="bfg-dialog">
        <p>The intended ${plannedDistanceCm} cm movement vector is now displayed on the canvas.</p>
        <label><input type="checkbox" class="bfg-ordnance-blast-choice" data-token-id="${token.document.id}" ${throughBlastMarker ? "checked" : ""}> Path passes through one or more Blast Markers</label>
      </div>`,
      yes: { label: "Execute Move", icon: "fa-solid fa-check" },
      no: { label: isTorpedo ? "Cancel" : "Edit Move", icon: isTorpedo ? "fa-solid fa-xmark" : "fa-solid fa-pen" },
      rejectClose: false,
      modal: false
    });
    throughBlastMarker = Boolean(blastMarkerChoices.get(token.document.id));
    blastMarkerChoices.delete(token.document.id);
    if (execute) break;
    clearOrdnanceMovementPreview();
    if (isTorpedo) return false;
  }

  const distanceCm = plannedDistanceCm;
  const rotation = plannedRotation;
  const movementStart = { x: Number(token.center.x), y: Number(token.center.y) };
  if (!Number.isFinite(distanceCm) || distanceCm < 0 || distanceCm > Number(marker.speedCm)) {
    ui.notifications.warn(`Movement must be between 0 and ${marker.speedCm} cm.`);
    return false;
  }

  if (throughBlastMarker) {
    const roll = await new Roll("1d6").evaluate();
    await publishBFGDice(roll, {
      speaker: ChatMessage.getSpeaker({ token: token.document }),
      flavor: `${token.name}: Ordnance passing through Blast Markers`
    });
    if (roll.total === 6) {
      await token.document.delete();
      clearOrdnanceMovementPreview();
      ui.notifications.warn(`${token.name} was destroyed by the Blast Marker.`);
      return true;
    }
  }

  const center = ordnanceDestination(token, distanceCm, rotation);
  await token.document.update({
    x: center.x - token.w / 2,
    y: center.y - token.h / 2,
    rotation,
    [`flags.${MODULE_ID}.${ORDNANCE_MARKER_FLAG}.lastMovedActivation`]: activationKey(state)
  }, { animate: true });
  clearOrdnanceMovementPreview();
  if (marker.category === "torpedo") {
    drawOrdnanceTrail(movementStart, center, Number(token.w));
  }
  return true;
}

export async function reloadSelectedShipOrdnance() {
  const ship = selectedToken();
  if (!ship || !getShipData(ship)?.ordnance?.length) {
    ui.notifications.warn("Select one ship with ordnance capacity.");
    return false;
  }
  if (!game.user?.isGM) {
    ui.notifications.warn("Only a Gamemaster can update the shared ordnance state.");
    return false;
  }
  await ship.document.setFlag(MODULE_ID, ORDNANCE_STATE_FLAG, {
    ...getOrdnanceState(ship),
    attackCraftLoaded: true,
    torpedoesLoaded: true
  });
  ui.notifications.info(`${ship.name}'s ordnance is loaded.`);
  return true;
}

export async function resetOrdnance() {
  clearOrdnanceMovementPreview();
  clearAllOrdnanceTrails({ notify: false });
  const tokens = [...(canvas.tokens?.placeables ?? [])];
  const markerIds = tokens
    .filter(token => getOrdnanceMarker(token))
    .map(token => token.document.id);
  if (markerIds.length) {
    await canvas.scene.deleteEmbeddedDocuments("Token", markerIds);
  }
  for (const token of tokens) {
    if (markerIds.includes(token.document.id)) continue;
    if (token.document.getFlag(MODULE_ID, ORDNANCE_STATE_FLAG) !== undefined) {
      await token.document.unsetFlag(MODULE_ID, ORDNANCE_STATE_FLAG);
    }
  }
}
