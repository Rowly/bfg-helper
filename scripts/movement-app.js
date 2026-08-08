import {
  getMovementContext,
  calculateMovementPath,
  drawMovementPreview,
  clearMovementPreview
} from "./movement.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BFGMovementPlannerApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bfg-helper-movement-planner",
    classes: ["bfg-helper", "bfg-movement-planner-window"],
    tag: "section",
    window: {
      title: "Battlefleet Gothic Movement Planner",
      icon: "fa-solid fa-route",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 430,
      height: "auto"
    }
  };

  static PARTS = {
    body: {
      template: "modules/bfg-helper/templates/movement-planner.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    this.tokenId = null;
    this.sceneId = null;
    this.lastPath = null;
  }

  setToken(token) {
    this.tokenId = token?.document?.id ?? null;
    this.sceneId = canvas.scene?.id ?? null;
    this.lastPath = null;
  }

  get token() {
    if (!this.tokenId || this.sceneId !== canvas.scene?.id) return null;
    return canvas.tokens?.get(this.tokenId) ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const token = this.token;
    const movementContext = getMovementContext(token);

    if (!movementContext.ok) {
      return foundry.utils.mergeObject(context, {
        invalid: true,
        error: movementContext.error
      }, { inplace: false });
    }

    const { shipData, movement, turnState, activeFleet, tokenFleet, warnings } = movementContext;

    return foundry.utils.mergeObject(context, {
      invalid: false,
      tokenName: token.name,
      shipClass: shipData.shipClass ?? token.actor?.name ?? "Configured ship",
      fleetName: tokenFleet?.name ?? "Unassigned",
      activeFleetName: activeFleet?.name ?? "None",
      phaseName: turnState.phase === "movement" ? "Movement" : String(turnState.phase ?? "Unknown"),
      speedCm: Number(movement.speedCm ?? 0),
      minimumBeforeTurnCm: Number(movement.minimumBeforeTurnCm ?? 0),
      maximumTurnDegrees: Number(movement.maximumTurnDegrees ?? 0),
      maximumTurns: Number(movement.maximumTurns ?? 1),
      defaultDistanceCm: Number(movement.speedCm ?? 0),
      defaultBeforeTurnCm: Number(movement.minimumBeforeTurnCm ?? 0),
      defaultSignedTurnDegrees: 0,
      hasWarnings: warnings.length > 0,
      warnings,
      previewSummary: this.lastPath
        ? `${this.lastPath.distanceCm} cm total; ${this.lastPath.hasTurn ? `${this.lastPath.beforeTurnCm} cm then ${this.lastPath.turnDirection} ${this.lastPath.turnDegrees}°` : "straight ahead"}.`
        : "No preview plotted."
    }, { inplace: false });
  }

  readValues() {
    const root = this.element;
    return {
      distanceCm: Number(root.querySelector('[name="distanceCm"]')?.value),
      beforeTurnCm: Number(root.querySelector('[name="beforeTurnCm"]')?.value),
      signedTurnDegrees: Number(root.querySelector('[name="signedTurnDegrees"]')?.value ?? 0)
    };
  }

  updateStatus(message, type = "normal") {
    const element = this.element?.querySelector("[data-bfg-movement-status]");
    if (!element) return;
    element.textContent = message;
    element.dataset.status = type;
  }

  updateTurnSliderLabel() {
    const slider = this.element?.querySelector('[name="signedTurnDegrees"]');
    const label = this.element?.querySelector("[data-bfg-turn-slider-value]");
    if (!slider || !label) return;

    const value = Number(slider.value ?? 0);
    const rounded = Number.isInteger(value) ? value : Math.round(value);

    if (rounded < 0) {
      label.textContent = `Port ${Math.abs(rounded)}°`;
      label.dataset.direction = "port";
    } else if (rounded > 0) {
      label.textContent = `Starboard ${rounded}°`;
      label.dataset.direction = "starboard";
    } else {
      label.textContent = "Straight ahead";
      label.dataset.direction = "straight";
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    if (context.invalid) return;

    const turnSlider = this.element.querySelector('[name="signedTurnDegrees"]');
    if (turnSlider) {
      this.updateTurnSliderLabel();
      turnSlider.addEventListener("input", () => this.updateTurnSliderLabel());
    }

    const bind = (selector, handler) => {
      const element = this.element.querySelector(selector);
      if (!element) return;
      element.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        await handler(event);
      });
    };

    bind('[data-bfg-action="preview-movement"]', async () => {
      try {
        const token = this.token;
        const movementContext = getMovementContext(token);
        if (!movementContext.ok) throw new Error(movementContext.error);

        const path = calculateMovementPath(token, movementContext.movement, this.readValues());
        drawMovementPreview(token, path);
        this.lastPath = path;

        const turnText = path.hasTurn
          ? `${path.beforeTurnCm} cm, then ${path.turnDirection} ${path.turnDegrees}°, then ${path.remainingCm} cm`
          : `${path.distanceCm} cm straight ahead`;

        this.updateStatus(`Preview: ${turnText}. Final facing ${path.finalRotation.toFixed(0)}°.`, "success");
      } catch (error) {
        console.error("BFG Helper | Movement preview failed", error);
        ui.notifications.warn(error.message ?? String(error));
        this.updateStatus(error.message ?? String(error), "error");
      }
    });

    bind('[data-bfg-action="clear-movement-preview"]', async () => {
      clearMovementPreview();
      this.lastPath = null;
      this.updateStatus("Movement preview cleared.", "normal");
    });

    bind('[data-bfg-action="reset-movement"]', async () => {
      clearMovementPreview();
      this.lastPath = null;
      await this.render({ force: true });
    });
  }

  async close(options = {}) {
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
  app.setToken(token);
  await app.render({ force: true });
  return app;
}

export function closeMovementPlannerApplication() {
  if (!movementPlannerApplication?.rendered) {
    clearMovementPreview();
    return;
  }
  movementPlannerApplication.close();
}
