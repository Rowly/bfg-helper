import {
  getMovementContext,
  calculateMovementPath,
  drawMovementPreview,
  clearMovementPreview,
  executeMovementPath
} from "./movement.js";
import { findRamContact } from "./ramming.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const INTERACTION_PREVIEW_NAME = "bfg-interactive-movement-controls";

function normaliseRotation(degrees) {
  let value = Number(degrees) % 360;
  if (value < 0) value += 360;
  return value;
}

function signedAngleDifference(bearing, origin) {
  let difference = normaliseRotation(bearing) - normaliseRotation(origin);
  if (difference > 180) difference -= 360;
  if (difference <= -180) difference += 360;
  return difference;
}

function forwardVector(rotationDegrees) {
  const radians = Number(rotationDegrees) * Math.PI / 180;
  return { x: Math.sin(radians), y: -Math.cos(radians) };
}

function distanceBetween(first, second) {
  return Math.hypot(Number(first.x) - Number(second.x), Number(first.y) - Number(second.y));
}

function describePath(path) {
  if (!path.hasTurn) return `${path.distanceCm.toFixed(1)} cm straight ahead`;
  const firstRemaining = path.hasSecondTurn ? path.intermediateCm : Math.max(0, path.distanceCm - path.beforeTurnCm);
  let text = `${path.beforeTurnCm.toFixed(1)} cm, ${path.turnDirection} ${path.turnDegrees.toFixed(0)} degrees, ${firstRemaining.toFixed(1)} cm`;
  if (path.hasSecondTurn) text += `, ${path.secondTurnDirection} ${path.secondTurnDegrees.toFixed(0)} degrees, ${path.remainingCm.toFixed(1)} cm`;
  return text;
}

function clearInteractionPreview() {
  const graphics = globalThis.bfgMovementInteractionPreview;
  if (graphics && !graphics.destroyed) graphics.destroy({ children: true });
  globalThis.bfgMovementInteractionPreview = null;
}

function drawInteractionPreview(token, path, state) {
  clearInteractionPreview();
  if (!canvas?.ready || !canvas.tokens || !path) return;
  const gridSize = Number(canvas.scene?.grid?.size) || 100;
  const lineWidth = Math.max(3, gridSize * 0.045);
  const handleRadius = Math.max(30, gridSize * 0.34);
  const graphics = new PIXI.Graphics();
  graphics.name = `${INTERACTION_PREVIEW_NAME}-${token.document.id}`;

  if (state.mode === "turn") {
    const pivot = state.pendingTurn === 1 ? path.turnPoint : path.secondTurnPoint;
    const inboundRotation = state.pendingTurn === 1 ? path.startRotation : path.firstTurnRotationRaw;
    const maximumTurn = Math.max(0, Number(state.maximumTurnDegrees));
    const radius = Math.max(Math.min(Number(token.w), Number(token.h)) * 0.8, gridSize * 0.9);
    const start = (inboundRotation - maximumTurn - 90) * Math.PI / 180;
    const end = (inboundRotation + maximumTurn - 90) * Math.PI / 180;
    graphics.beginFill(0xffcc66, 0.10);
    graphics.lineStyle(lineWidth, 0xffcc66, 0.9);
    graphics.moveTo(pivot.x, pivot.y);
    graphics.arc(pivot.x, pivot.y, radius, start, end, false);
    graphics.lineTo(pivot.x, pivot.y);
    graphics.endFill();
    const selectedRotation = state.pendingTurn === 1 ? path.firstTurnRotationRaw : path.finalRotationRaw;
    const vector = forwardVector(selectedRotation);
    graphics.lineStyle(lineWidth * 1.2, 0xffcc66, 1);
    graphics.moveTo(pivot.x, pivot.y);
    graphics.lineTo(pivot.x + vector.x * radius, pivot.y + vector.y * radius);
  }

  graphics.lineStyle(lineWidth, 0x66ff99, 1);
  graphics.beginFill(0x66ff99, 0.78);
  graphics.drawCircle(path.finalCenter.x, path.finalCenter.y, handleRadius);
  graphics.endFill();

  const currentLegCm = path.hasSecondTurn
    ? Math.max(0, path.distanceCm - path.beforeTurnCm - path.beforeSecondTurnCm)
    : path.hasTurn
      ? Math.max(0, path.distanceCm - path.beforeTurnCm)
      : path.distanceCm;
  const distanceLabel = new PIXI.Text(
    `Total ${path.distanceCm.toFixed(1)}/${path.speedCm.toFixed(1)} cm\nLeg ${currentLegCm.toFixed(1)} cm`,
    {
      fontFamily: "Arial, sans-serif",
      fontSize: 26,
      fontWeight: "bold",
      align: "left",
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 5
    }
  );
  const canvasZoom = Math.max(0.1, Number(canvas.stage?.scale?.x) || 1);
  const inverseZoom = 1 / canvasZoom;
  distanceLabel.anchor.set(0, 0.5);
  distanceLabel.scale.set(inverseZoom);
  distanceLabel.position.set(
    path.finalCenter.x + handleRadius + (14 * inverseZoom),
    path.finalCenter.y
  );
  graphics.addChild(distanceLabel);

  if (!path.hasTurn && Number(state.minimumBeforeTurnCm) === 0 && Number(state.maximumTurnDegrees) > 0) {
    graphics.lineStyle(lineWidth, 0xffcc66, 0.95);
    graphics.beginFill(0xffcc66, 0.35);
    graphics.drawCircle(path.start.x, path.start.y, handleRadius * 0.72);
    graphics.endFill();
  }
  canvas.tokens.addChild(graphics);
  globalThis.bfgMovementInteractionPreview = graphics;
}

export class BFGMovementPlannerApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bfg-helper-movement-planner",
    classes: ["bfg-helper", "bfg-movement-planner-window", "bfg-interactive-movement-window"],
    tag: "section",
    window: { title: "Battlefleet Gothic Movement", icon: "fa-solid fa-route", resizable: false, minimizable: true },
    position: { width: 370, height: "auto" }
  };

  static PARTS = { body: { template: "modules/bfg-helper/templates/movement-planner.hbs" } };

  constructor(options = {}) {
    super(options);
    this.tokenId = null;
    this.sceneId = null;
    this.lastPath = null;
    this.values = null;
    this.moveThroughBlastMarker = false;
    this.interaction = { mode: "segment", pendingTurn: 0, carryingEndpoint: false };
    this.canvasView = null;
    this.canvasPanHook = null;
    this.zoomRefreshTimer = null;
    this.boundPointerDown = event => this.onCanvasPointerDown(event);
    this.boundPointerMove = event => this.onCanvasPointerMove(event);
    this.boundContextMenu = event => this.onCanvasContextMenu(event);
  }

  setToken(token) {
    this.detachCanvasListeners();
    this.tokenId = token?.document?.id ?? null;
    this.sceneId = canvas.scene?.id ?? null;
    this.lastPath = null;
    this.values = null;
    this.moveThroughBlastMarker = false;
    this.interaction = { mode: "segment", pendingTurn: 0, carryingEndpoint: false };
  }

  get token() {
    if (!this.tokenId || this.sceneId !== canvas.scene?.id) return null;
    return canvas.tokens?.get(this.tokenId) ?? null;
  }

  movementLimits(context) {
    const maximum = Math.max(0, Number(context.movement.speedCm) - (this.moveThroughBlastMarker ? 5 : 0));
    const minimum = context.movement.minimumMovementCmOverride === null || context.movement.minimumMovementCmOverride === undefined
      ? Math.min(maximum, Number(context.movement.profileSpeedCm) / 2)
      : Math.min(maximum, Math.max(0, Number(context.movement.minimumMovementCmOverride)));
    return { minimum, maximum };
  }

  initialiseValues(context) {
    const limits = this.movementLimits(context);
    this.values = {
      distanceCm: limits.minimum,
      beforeTurnCm: limits.minimum,
      signedTurnDegrees: 0,
      beforeSecondTurnCm: 0,
      secondSignedTurnDegrees: 0,
      moveThroughBlastMarker: this.moveThroughBlastMarker
    };
    this.interaction = {
      mode: "segment", pendingTurn: 0, carryingEndpoint: false,
      maximumTurnDegrees: Number(context.movement.maximumTurnDegrees ?? 0),
      maximumTurns: Number(context.movement.maximumTurns ?? 1),
      minimumBeforeTurnCm: Number(context.movement.minimumBeforeTurnCm ?? 0)
    };
  }

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const movementContext = getMovementContext(this.token);
    if (!movementContext.ok) return foundry.utils.mergeObject(base, { invalid: true, error: movementContext.error }, { inplace: false });
    if (!this.values) this.initialiseValues(movementContext);
    const limits = this.movementLimits(movementContext);
    return foundry.utils.mergeObject(base, {
      invalid: false,
      tokenName: this.token.name,
      shipClass: movementContext.shipData.shipClass ?? this.token.actor?.name ?? "Configured ship",
      minimumMovementCm: limits.minimum,
      maximumMovementCm: limits.maximum,
      minimumBeforeTurnCm: Number(movementContext.movement.minimumBeforeTurnCm ?? 0),
      maximumTurnDegrees: Number(movementContext.movement.maximumTurnDegrees ?? 0),
      maximumTurns: Number(movementContext.movement.maximumTurns ?? 1),
      moveThroughBlastMarker: this.moveThroughBlastMarker,
      hasWarnings: movementContext.warnings.length > 0,
      warnings: movementContext.warnings
    }, { inplace: false });
  }

  canvasPoint(event) {
    const rect = this.canvasView.getBoundingClientRect();
    const screen = new PIXI.Point(
      (event.clientX - rect.left) * canvas.app.renderer.screen.width / rect.width,
      (event.clientY - rect.top) * canvas.app.renderer.screen.height / rect.height
    );
    return canvas.stage.toLocal(screen);
  }

  handleRadius() {
    return Math.max(36, (Number(canvas.scene?.grid?.size) || 100) * 0.42);
  }

  attachCanvasListeners() {
    this.detachCanvasListeners();
    this.canvasView = canvas.app?.view ?? canvas.app?.canvas;
    if (!this.canvasView) return;
    this.canvasView.addEventListener("pointerdown", this.boundPointerDown, true);
    this.canvasView.addEventListener("pointermove", this.boundPointerMove, true);
    this.canvasView.addEventListener("contextmenu", this.boundContextMenu, true);
    this.canvasPanHook = Hooks.on("canvasPan", () => this.scheduleZoomRefresh());
  }

  detachCanvasListeners() {
    if (this.canvasView) {
      this.canvasView.removeEventListener("pointerdown", this.boundPointerDown, true);
      this.canvasView.removeEventListener("pointermove", this.boundPointerMove, true);
      this.canvasView.removeEventListener("contextmenu", this.boundContextMenu, true);
    }
    if (this.canvasPanHook !== null) Hooks.off("canvasPan", this.canvasPanHook);
    if (this.zoomRefreshTimer !== null) window.clearTimeout(this.zoomRefreshTimer);
    this.canvasView = null;
    this.canvasPanHook = null;
    this.zoomRefreshTimer = null;
  }

  scheduleZoomRefresh() {
    if (this.zoomRefreshTimer !== null) window.clearTimeout(this.zoomRefreshTimer);
    this.zoomRefreshTimer = window.setTimeout(() => {
      this.zoomRefreshTimer = null;
      if (!this.rendered || !this.token || !this.lastPath) return;
      drawMovementPreview(this.token, this.lastPath);
      drawInteractionPreview(this.token, this.lastPath, this.interaction);
    }, 40);
  }

  consumeCanvasEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  onCanvasPointerDown(event) {
    if (event.button !== 0 || !this.lastPath) return;
    const point = this.canvasPoint(event);
    if (this.interaction.mode === "turn") {
      this.consumeCanvasEvent(event);
      const angle = this.interaction.pendingTurn === 1 ? this.values.signedTurnDegrees : this.values.secondSignedTurnDegrees;
      if (Math.abs(Number(angle)) < 1) {
        ui.notifications.warn("Choose a turn of at least 1 degree, or right-click to cancel the turn.");
        return;
      }
      this.interaction.mode = "segment";
      this.interaction.pendingTurn = 0;
      this.updateInteractivePath();
      return;
    }

    if (this.interaction.carryingEndpoint) {
      this.consumeCanvasEvent(event);
      this.dragEndpoint(point);
      this.interaction.carryingEndpoint = false;
      this.tryBeginNextTurn();
      this.updatePanel();
      return;
    }

    const endpointHit = distanceBetween(point, this.lastPath.finalCenter) <= this.handleRadius();
    const startTurnHit = !this.lastPath.hasTurn
      && Number(this.interaction.minimumBeforeTurnCm) === 0
      && Number(this.interaction.maximumTurnDegrees) > 0
      && distanceBetween(point, this.lastPath.start) <= this.handleRadius();
    if (!endpointHit && !startTurnHit) return;
    this.consumeCanvasEvent(event);
    if (startTurnHit) {
      this.beginTurn(1, true);
      return;
    }
    this.interaction.carryingEndpoint = true;
    this.updatePanel();
  }

  onCanvasPointerMove(event) {
    if (!this.lastPath) return;
    const point = this.canvasPoint(event);
    if (this.interaction.mode === "turn") {
      this.consumeCanvasEvent(event);
      this.updatePendingTurn(point);
      return;
    }
    if (!this.interaction.carryingEndpoint) return;
    this.consumeCanvasEvent(event);
    this.dragEndpoint(point);
  }

  onCanvasContextMenu(event) {
    if (this.interaction.carryingEndpoint) {
      this.consumeCanvasEvent(event);
      this.interaction.carryingEndpoint = false;
      this.updatePanel();
      return;
    }
    if (this.interaction.mode !== "turn") return;
    this.consumeCanvasEvent(event);
    if (this.interaction.pendingTurn === 1) {
      this.values.signedTurnDegrees = 0;
      this.values.beforeTurnCm = this.values.distanceCm;
    } else {
      this.values.secondSignedTurnDegrees = 0;
      this.values.beforeSecondTurnCm = 0;
    }
    this.interaction.mode = "segment";
    this.interaction.pendingTurn = 0;
    this.updateInteractivePath();
  }

  dragEndpoint(point) {
    const path = this.lastPath;
    let origin;
    let rotation;
    let consumed;
    if (path.hasSecondTurn) {
      origin = path.secondTurnPoint;
      rotation = path.finalRotationRaw;
      consumed = path.beforeTurnCm + path.beforeSecondTurnCm;
    } else if (path.hasTurn) {
      origin = path.turnPoint;
      rotation = path.firstTurnRotationRaw;
      consumed = path.beforeTurnCm;
    } else {
      origin = path.start;
      rotation = path.startRotation;
      consumed = 0;
    }
    const vector = forwardVector(rotation);
    const projectedPixels = (point.x - origin.x) * vector.x + (point.y - origin.y) * vector.y;
    const projectedCm = projectedPixels / path.pixelsPerCm;
    const minimumTotal = Math.max(path.minimumMovementCm, consumed);
    this.values.distanceCm = Math.max(minimumTotal, Math.min(path.speedCm, consumed + projectedCm));
    this.updateInteractivePath();
  }

  tryBeginNextTurn() {
    const path = this.lastPath;
    if (!(Number(this.interaction.maximumTurnDegrees) > 0)) {
      return false;
    }
    if (!path.hasTurn) {
      if (path.distanceCm + 0.001 < Number(this.interaction.minimumBeforeTurnCm)) {
        ui.notifications.warn(`This ship must move ${this.interaction.minimumBeforeTurnCm} cm before turning.`);
        return false;
      }
      this.beginTurn(1, false);
      return true;
    }
    if (path.hasSecondTurn || Number(this.interaction.maximumTurns) < 2) {
      return false;
    }
    const distanceSinceTurn = path.distanceCm - path.beforeTurnCm;
    if (distanceSinceTurn + 0.001 < Number(this.interaction.minimumBeforeTurnCm)) {
      ui.notifications.warn(`This ship must move ${this.interaction.minimumBeforeTurnCm} cm between turns.`);
      return false;
    }
    this.beginTurn(2, false);
    return true;
  }

  beginTurn(index, atStart) {
    if (index === 1) {
      this.values.beforeTurnCm = atStart ? 0 : this.values.distanceCm;
      this.values.signedTurnDegrees = 1;
    } else {
      this.values.beforeSecondTurnCm = this.values.distanceCm - this.values.beforeTurnCm;
      this.values.secondSignedTurnDegrees = 1;
    }
    this.interaction.mode = "turn";
    this.interaction.pendingTurn = index;
    this.updateInteractivePath();
  }

  updatePendingTurn(point) {
    const path = this.lastPath;
    const pivot = this.interaction.pendingTurn === 1 ? path.turnPoint : path.secondTurnPoint;
    const inbound = this.interaction.pendingTurn === 1 ? path.startRotation : path.firstTurnRotationRaw;
    const bearing = normaliseRotation(Math.atan2(point.x - pivot.x, -(point.y - pivot.y)) * 180 / Math.PI);
    const maximum = Number(this.interaction.maximumTurnDegrees);
    const signed = Math.round(Math.max(-maximum, Math.min(maximum, signedAngleDifference(bearing, inbound))));
    if (this.interaction.pendingTurn === 1) this.values.signedTurnDegrees = signed;
    else this.values.secondSignedTurnDegrees = signed;
    this.updateInteractivePath();
  }

  updateInteractivePath() {
    try {
      const context = getMovementContext(this.token);
      if (!context.ok) throw new Error(context.error);
      this.values.moveThroughBlastMarker = this.moveThroughBlastMarker;
      const path = calculateMovementPath(this.token, context.movement, this.values);
      const ram = context.specialOrder?.id === "all-ahead-full" ? context.specialOrder.ram : null;
      const ramTarget = ram?.passed ? canvas.tokens?.get(ram.targetId) : null;
      if (ramTarget) {
        path.ramContact = findRamContact(this.token, ramTarget, path.start, path.finalCenter);
        path.ramTargetName = ramTarget.name;
      }
      this.lastPath = path;
      drawMovementPreview(this.token, path);
      drawInteractionPreview(this.token, path, this.interaction);
      this.updatePanel();
    } catch (error) {
      console.error("BFG Helper | Interactive movement update failed", error);
      ui.notifications.warn(error.message ?? String(error));
      this.updateStatus(error.message ?? String(error), "error");
    }
  }

  updatePanel() {
    if (!this.lastPath || !this.element) return;
    const summary = this.element.querySelector("[data-bfg-movement-summary]");
    const distance = this.element.querySelector("[data-bfg-movement-distance]");
    const facing = this.element.querySelector("[data-bfg-movement-facing]");
    if (summary) summary.textContent = describePath(this.lastPath);
    if (distance) distance.textContent = `${this.lastPath.distanceCm.toFixed(1)} / ${this.lastPath.speedCm.toFixed(1)} cm`;
    if (facing) facing.textContent = `${this.lastPath.finalRotation.toFixed(0)} degrees`;
    this.updateStatus(
      this.interaction.mode === "turn" ? "Selecting a new heading" : this.interaction.carryingEndpoint ? "Moving endpoint" : "Path ready to adjust",
      "success"
    );
  }

  updateStatus(message, type = "normal") {
    const element = this.element?.querySelector("[data-bfg-movement-status]");
    if (!element) return;
    element.textContent = message;
    element.dataset.status = type;
  }

  resetPlan() {
    const context = getMovementContext(this.token);
    if (!context.ok) throw new Error(context.error);
    this.initialiseValues(context);
    this.updateInteractivePath();
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (context.invalid) return;
    this.attachCanvasListeners();
    const blastMarker = this.element.querySelector('[name="moveThroughBlastMarker"]');
    blastMarker?.addEventListener("change", () => {
      this.moveThroughBlastMarker = Boolean(blastMarker.checked);
      this.resetPlan();
    });
    const bind = (selector, handler) => {
      const element = this.element.querySelector(selector);
      element?.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        await handler();
      });
    };
    bind('[data-bfg-action="reset-movement"]', async () => this.resetPlan());
    bind('[data-bfg-action="cancel-movement"]', async () => this.close());
    bind('[data-bfg-action="execute-movement"]', async () => {
      try {
        if (this.interaction.mode === "turn") throw new Error("Finish selecting the turn heading before confirming movement.");
        if (this.interaction.carryingEndpoint) throw new Error("Place or right-click to drop the movement endpoint before confirming movement.");
        const token = this.token;
        const executedPath = await executeMovementPath(token, this.lastPath);
        this.lastPath = null;
        clearInteractionPreview();
        ui.notifications.info(`${token.name} movement executed: ${describePath(executedPath)}.`);
        await this.close();
      } catch (error) {
        console.error("BFG Helper | Movement execution failed", error);
        ui.notifications.warn(error.message ?? String(error));
        this.updateStatus(error.message ?? String(error), "error");
      }
    });
    this.updateInteractivePath();
  }

  async close(options = {}) {
    this.detachCanvasListeners();
    clearInteractionPreview();
    clearMovementPreview();
    return super.close(options);
  }
}

let movementPlannerApplication = null;

export function getMovementPlannerApplication() {
  movementPlannerApplication ??= new BFGMovementPlannerApplication();
  return movementPlannerApplication;
}

export async function openMovementPlannerApplication(token) {
  const app = getMovementPlannerApplication();
  clearMovementPreview();
  clearInteractionPreview();
  app.setToken(token);
  await app.render({ force: true });
  return app;
}

export function closeMovementPlannerApplication() {
  if (!movementPlannerApplication?.rendered) {
    clearMovementPreview();
    clearInteractionPreview();
    return;
  }
  movementPlannerApplication.close();
}
