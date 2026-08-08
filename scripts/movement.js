import { getShipData, getBaseActor } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getTurnState, PHASES } from "./turn-manager.js";

const PREVIEW_NAME = "bfg-movement-preview";

function getSceneScale() {
  const gridSize = Number(canvas.scene?.grid?.size);
  const gridDistance = Number(canvas.scene?.grid?.distance);

  if (
    !Number.isFinite(gridSize) ||
    !Number.isFinite(gridDistance) ||
    gridSize <= 0 ||
    gridDistance <= 0
  ) {
    throw new Error("The current Scene does not have a valid grid size and distance.");
  }

  return {
    gridSize,
    gridDistance,
    pixelsPerCm: gridSize / gridDistance
  };
}

function normaliseRotation(degrees) {
  let value = Number(degrees) % 360;
  if (value < 0) value += 360;
  return value;
}

function forwardVector(rotationDegrees) {
  const radians = Number(rotationDegrees) * Math.PI / 180;
  return {
    x: Math.sin(radians),
    y: -Math.cos(radians)
  };
}

export function getMovementContext(token = canvas.tokens.controlled[0]) {
  if (!token) {
    return {
      ok: false,
      error: "Please select exactly one configured ship token."
    };
  }

  const actor = getBaseActor(token);
  const shipData = getShipData(actor);
  const movement = shipData?.movement;

  if (!shipData || !movement) {
    return {
      ok: false,
      error: `${token.name} does not have a configured BFG movement profile.`
    };
  }

  const turnState = getTurnState();
  const activeFleet = turnState.fleets?.[turnState.activeFleetIndex] ?? null;
  const tokenFleetId = getTokenFleetId(token);
  const tokenFleet = turnState.fleets?.find(fleet => fleet.id === tokenFleetId) ?? null;
  const phase = PHASES.find(item => item.id === turnState.phase) ?? null;

  const warnings = [];
  let blocked = false;

  if (!turnState.battleStarted) {
    warnings.push("No battle is currently running. Movement preview is available for testing.");
  } else {
    if (turnState.phase !== "movement") {
      const message = `The current phase is ${phase?.label ?? turnState.phase}, not Movement.`;
      if (game.user?.isGM) warnings.push(`${message} Gamemaster preview override is available.`);
      else blocked = true;
    }

    if (!tokenFleetId) {
      const message = `${token.name} is not assigned to a fleet.`;
      if (game.user?.isGM) warnings.push(`${message} Gamemaster preview override is available.`);
      else blocked = true;
    } else if (activeFleet && tokenFleetId !== activeFleet.id) {
      const message = `${token.name} belongs to ${tokenFleet?.name ?? tokenFleetId}, but ${activeFleet.name} is active.`;
      if (game.user?.isGM) warnings.push(`${message} Gamemaster preview override is available.`);
      else blocked = true;
    }
  }

  if (blocked) {
    return {
      ok: false,
      error: "This ship cannot plan movement during the current fleet/phase state."
    };
  }

  return {
    ok: true,
    token,
    actor,
    shipData,
    movement,
    turnState,
    activeFleet,
    tokenFleet,
    warnings
  };
}

/**
 * Calculate a BFG-style two-segment movement path.
 *
 * distanceCm is the total movement used. If a turn is selected, beforeTurnCm
 * is the distance travelled on the current heading before pivoting the ship.
 * The remaining movement continues along the new heading.
 */
export function calculateMovementPath(token, movement, values = {}) {
  const { pixelsPerCm } = getSceneScale();

  const speedCm = Number(movement.speedCm);
  const minimumBeforeTurnCm = Math.max(0, Number(movement.minimumBeforeTurnCm ?? 0));
  const maximumTurnDegrees = Math.max(0, Number(movement.maximumTurnDegrees ?? 0));

  const distanceCm = Number(values.distanceCm);
  let beforeTurnCm = Number(values.beforeTurnCm);
  /*
   * Signed turn value used by the Movement Planner slider:
   *   negative = port
   *   zero     = straight ahead
   *   positive = starboard
   *
   * Keep support for the older turnDirection/turnDegrees values so any
   * existing wrapper code remains compatible during development.
   */
  let signedTurnDegrees;

  if (values.signedTurnDegrees !== undefined) {
    signedTurnDegrees = Number(values.signedTurnDegrees);
  } else {
    const legacyTurnDegrees = Number(values.turnDegrees ?? 0);
    const legacyTurnDirection = String(values.turnDirection ?? "none");
    signedTurnDegrees = legacyTurnDirection === "port"
      ? -Math.abs(legacyTurnDegrees)
      : legacyTurnDirection === "starboard"
        ? Math.abs(legacyTurnDegrees)
        : 0;
  }

  if (!Number.isFinite(distanceCm) || distanceCm < 0) {
    throw new Error("Movement distance must be zero or greater.");
  }

  if (!Number.isFinite(speedCm) || speedCm < 0) {
    throw new Error("This ship has an invalid movement allowance.");
  }

  if (distanceCm > speedCm) {
    throw new Error(`This ship may move a maximum of ${speedCm} cm.`);
  }

  if (!Number.isFinite(beforeTurnCm) || beforeTurnCm < 0) beforeTurnCm = 0;
  if (!Number.isFinite(signedTurnDegrees)) signedTurnDegrees = 0;

  /*
   * The slider constrains this already, but clamp again here so movement
   * rules remain safe even if values are supplied from the console or a
   * future UI.
   */
  signedTurnDegrees = Math.max(
    -maximumTurnDegrees,
    Math.min(maximumTurnDegrees, signedTurnDegrees)
  );

  const turnDegrees = Math.abs(signedTurnDegrees);
  const turnDirection = signedTurnDegrees < 0
    ? "port"
    : signedTurnDegrees > 0
      ? "starboard"
      : "none";

  const hasTurn = turnDegrees > 0;

  if (hasTurn) {
    if (beforeTurnCm < minimumBeforeTurnCm) {
      throw new Error(
        `This ship must move at least ${minimumBeforeTurnCm} cm before turning.`
      );
    }

    if (beforeTurnCm > distanceCm) {
      throw new Error("The turn point cannot be beyond the total movement distance.");
    }
  } else {
    // A straight move has no meaningful turn point.
    beforeTurnCm = distanceCm;
  }

  const start = {
    x: Number(token.center.x),
    y: Number(token.center.y)
  };

  const startRotation = Number(token.document.rotation ?? 0);
  const firstVector = forwardVector(startRotation);
  const firstDistancePixels = beforeTurnCm * pixelsPerCm;

  const turnPoint = {
    x: start.x + firstVector.x * firstDistancePixels,
    y: start.y + firstVector.y * firstDistancePixels
  };

  const signedTurn = hasTurn ? signedTurnDegrees : 0;

  const finalRotationRaw = startRotation + signedTurn;
  const finalRotation = normaliseRotation(finalRotationRaw);
  const secondVector = forwardVector(finalRotationRaw);
  const remainingCm = Math.max(0, distanceCm - beforeTurnCm);
  const secondDistancePixels = remainingCm * pixelsPerCm;

  const finalCenter = {
    x: turnPoint.x + secondVector.x * secondDistancePixels,
    y: turnPoint.y + secondVector.y * secondDistancePixels
  };

  return {
    distanceCm,
    beforeTurnCm,
    remainingCm,
    turnDirection: hasTurn ? turnDirection : "none",
    turnDegrees: hasTurn ? turnDegrees : 0,
    signedTurnDegrees: hasTurn ? signedTurn : 0,
    hasTurn,
    speedCm,
    minimumBeforeTurnCm,
    maximumTurnDegrees,
    pixelsPerCm,
    start,
    turnPoint,
    finalCenter,
    startRotation,
    finalRotation,
    finalRotationRaw
  };
}

export function clearMovementPreview() {
  const preview = globalThis.bfgMovementPreview;

  if (preview && !preview.destroyed) {
    preview.destroy({ children: true });
  }

  globalThis.bfgMovementPreview = null;
}

function drawArrowHead(graphics, endX, endY, rotationDegrees, size) {
  const angle = (Number(rotationDegrees) - 90) * Math.PI / 180;
  const left = angle + (150 * Math.PI / 180);
  const right = angle - (150 * Math.PI / 180);

  graphics.moveTo(endX, endY);
  graphics.lineTo(endX + Math.cos(left) * size, endY + Math.sin(left) * size);
  graphics.moveTo(endX, endY);
  graphics.lineTo(endX + Math.cos(right) * size, endY + Math.sin(right) * size);
}

/** Draw a client-side preview. This does not move or rotate the TokenDocument. */
export function drawMovementPreview(token, path) {
  clearMovementPreview();

  if (!canvas?.ready || !canvas.tokens) {
    throw new Error("The canvas is not ready.");
  }

  const { gridSize } = getSceneScale();
  const graphics = new PIXI.Graphics();
  graphics.name = `${PREVIEW_NAME}-${token.document.id}`;

  const lineWidth = Math.max(4, gridSize * 0.06);
  const markerRadius = Math.max(8, gridSize * 0.18);
  const baseRadius = Math.min(Number(token.w), Number(token.h)) / 2;

  // Starting-base reference.
  graphics.lineStyle(lineWidth * 0.65, 0xffffff, 0.35);
  graphics.drawCircle(path.start.x, path.start.y, baseRadius);

  // First movement segment.
  graphics.lineStyle(lineWidth, 0x66ccff, 0.95);
  graphics.moveTo(path.start.x, path.start.y);
  graphics.lineTo(path.turnPoint.x, path.turnPoint.y);

  if (path.hasTurn) {
    // Pivot point.
    graphics.beginFill(0xffcc66, 0.9);
    graphics.drawCircle(path.turnPoint.x, path.turnPoint.y, markerRadius);
    graphics.endFill();

    // Small turn arc to make the direction of rotation obvious.
    const turnArcRadius = Math.max(baseRadius * 0.45, gridSize * 0.8);
    const startAngle = (path.startRotation - 90) * Math.PI / 180;
    const endAngle = (path.finalRotationRaw - 90) * Math.PI / 180;
    graphics.lineStyle(lineWidth * 0.8, 0xffcc66, 0.95);
    graphics.arc(
      path.turnPoint.x,
      path.turnPoint.y,
      turnArcRadius,
      startAngle,
      endAngle,
      path.turnDirection === "port"
    );

    // Second movement segment.
    graphics.lineStyle(lineWidth, 0xffcc66, 0.95);
    graphics.moveTo(path.turnPoint.x, path.turnPoint.y);
    graphics.lineTo(path.finalCenter.x, path.finalCenter.y);
  }

  // Final base position ghost.
  graphics.lineStyle(lineWidth, 0x66ff99, 0.95);
  graphics.beginFill(0x66ff99, 0.12);
  graphics.drawCircle(path.finalCenter.x, path.finalCenter.y, baseRadius);
  graphics.endFill();

  // Final heading indicator.
  const finalVector = forwardVector(path.finalRotationRaw);
  const arrowLength = Math.max(baseRadius * 1.35, gridSize * 1.5);
  const arrowEndX = path.finalCenter.x + finalVector.x * arrowLength;
  const arrowEndY = path.finalCenter.y + finalVector.y * arrowLength;
  graphics.lineStyle(lineWidth, 0x66ff99, 1);
  graphics.moveTo(path.finalCenter.x, path.finalCenter.y);
  graphics.lineTo(arrowEndX, arrowEndY);
  drawArrowHead(graphics, arrowEndX, arrowEndY, path.finalRotationRaw, Math.max(gridSize * 0.35, 12));

  canvas.tokens.addChild(graphics);
  globalThis.bfgMovementPreview = graphics;

  return graphics;
}

export function previewSelectedShipMovement(token, values) {
  const context = getMovementContext(token);
  if (!context.ok) throw new Error(context.error);

  const path = calculateMovementPath(context.token, context.movement, values);
  drawMovementPreview(context.token, path);
  return path;
}

export async function openMovementPlanner(token = canvas.tokens.controlled[0]) {
  const context = getMovementContext(token);
  if (!context.ok) {
    ui.notifications.warn(context.error);
    return false;
  }

  const { openMovementPlannerApplication } = await import("./movement-app.js");
  await openMovementPlannerApplication(context.token);
  return true;
}

// Compatibility alias: the old Move Ship macro now opens the preview planner.
export const moveSelectedShip = openMovementPlanner;
