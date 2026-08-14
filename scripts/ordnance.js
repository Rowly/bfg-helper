import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { getCombatState, halveRoundedUp } from "./combat-state.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getTurnState } from "./turn-manager.js";
import { publishBFGDice } from "./dice.js";

export const ORDNANCE_MARKER_FLAG = "ordnanceMarker";
export const ORDNANCE_STATE_FLAG = "ordnanceState";
const ORDNANCE_PREVIEW_NAME = "bfg-ordnance-movement-preview";
let ordnanceControlsInitialised = false;
const blastMarkerChoices = new Map();

export function initialiseOrdnanceControls() {
  if (ordnanceControlsInitialised) return;
  ordnanceControlsInitialised = true;

  document.addEventListener("pointerdown", event => {
    const dial = event.target?.closest?.(".bfg-bearing-dial");
    if (!dial) return;
    event.preventDefault();

    const bounds = dial.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const bearing = Math.round((Math.atan2(x, -y) * 180 / Math.PI + 360) % 360);
    const input = dial.querySelector('input[name="rotation"]');
    const needle = dial.querySelector(".bfg-bearing-needle");
    const output = dial.querySelector("output");

    if (input) {
      input.value = String(bearing);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (needle) needle.style.transform = `translateX(-50%) rotate(${bearing}deg)`;
    if (output) output.value = `${bearing}°`;
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

function selectedToken() {
  const selected = canvas.tokens?.controlled ?? [];
  if (selected.length !== 1) {
    ui.notifications.warn("Please select exactly one ship or ordnance marker.");
    return null;
  }
  return selected[0];
}

function activationKey(state = getTurnState()) {
  return `${state.battleId ?? "no-battle"}:${state.round}:${state.activeFleetIndex}:${state.phase}`;
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

function effectiveBayCapacity(shipData, combatState) {
  const total = (shipData?.ordnance ?? []).reduce(
    (sum, bay) => sum + Math.max(0, Number(bay.capacity) || 0), 0
  );
  return combatState?.crippled ? halveRoundedUp(total) : total;
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
    return sum + effectiveBayCapacity(getShipData(token), combat);
  }, 0);
}

function launchErrors(token, state, fleetId) {
  const errors = [];
  const combat = getCombatState(token);
  if (!state.battleStarted) errors.push("No battle is in progress.");
  if (state.phase !== "shooting") errors.push("Attack craft are launched at the end of the Shooting phase.");
  if (!fleetId) errors.push(`${token.name} is not assigned to a fleet.`);
  const activeFleet = state.fleets?.[state.activeFleetIndex];
  if (fleetId && activeFleet?.id !== fleetId) errors.push(`${token.name} does not belong to the active fleet.`);
  if (combat?.outOfAction) errors.push(`${token.name} is out of action.`);
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
  if (existing) return existing;

  if (!game.user?.isGM) {
    throw new Error(`A Gamemaster must create the ${craft.name} marker Actor before players can launch it.`);
  }

  const actor = await Actor.create({
    name: craft.name,
    type: actorType(),
    img: "icons/svg/wing.svg",
    prototypeToken: {
      name: craft.name,
      width: 2,
      height: 2,
      texture: { src: "icons/svg/wing.svg", fit: "contain" },
      disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      lockRotation: false
    },
    flags: { [MODULE_ID]: { ordnanceActorType: craft.id } }
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

  const shipCapacity = effectiveBayCapacity(shipData, getCombatState(ship));
  const fleetLimit = fleetLaunchBayLimit(fleetId);
  const inPlay = fleetAttackCraftInPlay(fleetId);
  const available = Math.max(0, Math.min(shipCapacity, fleetLimit - inPlay));
  if (!available) {
    ui.notifications.warn(`The fleet attack-craft limit is reached (${inPlay}/${fleetLimit}).`);
    return false;
  }

  const fields = craft.map(item => `
    <label>${foundry.utils.escapeHTML(item.name)} (${item.speedCm} cm)</label>
    <input type="number" name="${item.id}" value="0" min="0" max="${available}" step="1">`
  ).join("");
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: `Launch Attack Craft: ${ship.name}` },
    content: `<div class="bfg-dialog"><p>Launch up to ${available} squadron markers. Any amount expends this ship's loaded attack craft.</p>${fields}</div>`,
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

  await canvas.scene.createEmbeddedDocuments("Token", tokenData);
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
  const marker = getOrdnanceMarker(token);
  if (!marker) {
    ui.notifications.warn(`${token.name} is not a BFG ordnance marker.`);
    return false;
  }

  const state = getTurnState();
  const errors = [];
  if (!state.battleStarted) errors.push("No battle is in progress.");
  if (state.phase !== "ordnance") errors.push("The current phase is not Ordnance.");
  const activeFleet = state.fleets?.[state.activeFleetIndex];
  if (activeFleet?.id !== marker.fleetId) errors.push(`${token.name} does not belong to the active fleet.`);
  if (marker.lastMovedActivation === activationKey(state)) errors.push(`${token.name} has already moved in this Ordnance phase.`);
  if (!await confirmGMOverride(errors, "Override Ordnance Movement Restriction?")) return false;

  let result;
  let plannedDistanceCm = Number(marker.speedCm);
  let plannedRotation = Number(token.document.rotation ?? 0);
  let throughBlastMarker = false;
  while (true) {
    result = await foundry.applications.api.DialogV2.input({
      window: { title: `Plan Ordnance Move: ${token.name}` },
      content: `<div class="bfg-dialog">
        <p>${foundry.utils.escapeHTML(marker.name)} may move up to ${marker.speedCm} cm in any direction.</p>
        <label>Distance (cm)</label><input type="range" class="bfg-ordnance-distance-slider" name="distanceCm" value="${plannedDistanceCm}" min="0" max="${marker.speedCm}" step="0.5"><output>${plannedDistanceCm} cm</output>
        <label>Bearing</label>
        <div class="bfg-bearing-dial" title="Click the compass to choose a bearing">
          <span class="bfg-bearing-cardinal north">0°</span>
          <span class="bfg-bearing-cardinal east">90°</span>
          <span class="bfg-bearing-cardinal south">180°</span>
          <span class="bfg-bearing-cardinal west">270°</span>
          <span class="bfg-bearing-needle" style="transform: translateX(-50%) rotate(${plannedRotation}deg)"></span>
          <span class="bfg-bearing-centre"></span>
          <input type="hidden" name="rotation" value="${plannedRotation}">
          <output>${plannedRotation}°</output>
        </div>
        <small>Click toward the desired direction of travel.</small>
      </div>`,
      ok: { label: "Preview Vector", icon: "fa-solid fa-route" },
      rejectClose: false,
      modal: true
    });
    if (!result) {
      clearOrdnanceMovementPreview();
      return false;
    }

    plannedDistanceCm = Number(result.distanceCm);
    plannedRotation = Number(result.rotation);
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
      no: { label: "Edit Move", icon: "fa-solid fa-pen" },
      rejectClose: false,
      modal: false
    });
    throughBlastMarker = Boolean(blastMarkerChoices.get(token.document.id));
    blastMarkerChoices.delete(token.document.id);
    if (execute) break;
    clearOrdnanceMovementPreview();
  }

  const distanceCm = plannedDistanceCm;
  const rotation = plannedRotation;
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
  return true;
}

export async function reloadSelectedShipOrdnance() {
  const ship = selectedToken();
  if (!ship || !getShipData(ship)?.ordnance?.length) {
    ui.notifications.warn("Select one ship with ordnance capacity.");
    return false;
  }
  if (!game.user?.isGM) {
    ui.notifications.warn("Reload Ordnance special orders are not implemented yet; only a Gamemaster can set this testing state.");
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
