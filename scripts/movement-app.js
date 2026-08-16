import {
  getMovementContext,
  calculateMovementPath,
  drawMovementPreview,
  clearMovementPreview,
  executeMovementPath
} from "./movement.js";
import { findRamContact } from "./ramming.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function describePath(path) {
  if (!path.hasTurn) return `${path.distanceCm} cm straight ahead`;
  let text = `${path.beforeTurnCm} cm, then ${path.turnDirection} ${path.turnDegrees} degrees`;
  if (path.hasSecondTurn) text += `, then ${path.intermediateCm} cm, then ${path.secondTurnDirection} ${path.secondTurnDegrees} degrees`;
  return `${text}, then ${path.remainingCm} cm`;
}

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
    this.moveThroughBlastMarker = false;
  }

  setToken(token) {
    this.tokenId = token?.document?.id ?? null;
    this.sceneId = canvas.scene?.id ?? null;
    this.lastPath = null;
    this.moveThroughBlastMarker = false;
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

    const { shipData, movement, turnState, activeFleet, tokenFleet, warnings, specialOrder } = movementContext;
    const blastPenaltyCm = this.moveThroughBlastMarker ? 5 : 0;
    const maximumMovementCm = Math.max(0, Number(movement.speedCm) - blastPenaltyCm);
    const minimumMovementCm = movement.minimumMovementCmOverride === null || movement.minimumMovementCmOverride === undefined
      ? Math.min(maximumMovementCm, Number(movement.profileSpeedCm) / 2)
      : Math.min(maximumMovementCm, Math.max(0, Number(movement.minimumMovementCmOverride)));

    return foundry.utils.mergeObject(context, {
      invalid: false,
      tokenName: token.name,
      shipClass: shipData.shipClass ?? token.actor?.name ?? "Configured ship",
      fleetName: tokenFleet?.name ?? "Unassigned",
      activeFleetName: activeFleet?.name ?? "None",
      phaseName: turnState.phase === "movement" ? "Movement" : String(turnState.phase ?? "Unknown"),
      speedCm: maximumMovementCm,
      profileSpeedCm: Number(movement.profileSpeedCm ?? 0),
      minimumMovementCm,
      blastPenaltyCm,
      moveThroughBlastMarker: this.moveThroughBlastMarker,
      minimumBeforeTurnCm: Number(movement.minimumBeforeTurnCm ?? 0),
      maximumTurnDegrees: Number(movement.maximumTurnDegrees ?? 0),
      turnSliderMaximum: Math.max(1, Number(movement.maximumTurnDegrees ?? 0)),
      turningUnavailable: Number(movement.maximumTurnDegrees ?? 0) <= 0,
      turningLockTitle: specialOrder?.id === "lock-on"
        ? "Locked On"
        : specialOrder?.id === "all-ahead-full"
          ? "All Ahead Full"
          : "Turning unavailable",
      turningLockMessage: specialOrder?.id === "lock-on"
        ? "This ship must maintain its current heading."
        : specialOrder?.id === "all-ahead-full"
          ? "This ship cannot turn while moving at full thrust."
          : "The ship cannot turn because of its current condition.",
      maximumTurns: Number(movement.maximumTurns ?? 1),
      defaultDistanceCm: maximumMovementCm,
      defaultBeforeTurnCm: Number(movement.minimumBeforeTurnCm ?? 0),
      defaultSignedTurnDegrees: 0,
      allowsSecondTurn: Number(movement.maximumTurns ?? 1) > 1,
      defaultBeforeSecondTurnCm: Number(movement.minimumBeforeTurnCm ?? 0),
      defaultSecondSignedTurnDegrees: 0,
      hasWarnings: warnings.length > 0,
      warnings,
      canExecute: Boolean(this.lastPath),
      previewSummary: this.lastPath
        ? `${this.lastPath.distanceCm} cm total; ${describePath(this.lastPath)}.`
        : "No preview plotted."
    }, { inplace: false });
  }

  readValues() {
    const root = this.element;
    return {
      distanceCm: Number(root.querySelector('[name="distanceCm"]')?.value),
      beforeTurnCm: Number(root.querySelector('[name="beforeTurnCm"]')?.value),
      signedTurnDegrees: Number(root.querySelector('[name="signedTurnDegrees"]')?.value ?? 0),
      beforeSecondTurnCm: Number(root.querySelector('[name="beforeSecondTurnCm"]')?.value ?? 0),
      secondSignedTurnDegrees: Number(root.querySelector('[name="secondSignedTurnDegrees"]')?.value ?? 0),
      moveThroughBlastMarker: Boolean(root.querySelector('[name="moveThroughBlastMarker"]')?.checked)
    };
  }

  updateStatus(message, type = "normal") {
    const element = this.element?.querySelector("[data-bfg-movement-status]");
    if (!element) return;
    element.textContent = message;
    element.dataset.status = type;
  }

  updateTurnSliderLabel(name = "signedTurnDegrees", labelSelector = "[data-bfg-turn-slider-value]") {
    const slider = this.element?.querySelector(`[name="${name}"]`);
    const label = this.element?.querySelector(labelSelector);
    if (!slider || !label) return;

    const value = Number(slider.value ?? 0);
    const rounded = Number.isInteger(value) ? value : Math.round(value);

    if (rounded < 0) {
      label.textContent = `Port ${Math.abs(rounded)} degrees`;
      label.dataset.direction = "port";
    } else if (rounded > 0) {
      label.textContent = `Starboard ${rounded} degrees`;
      label.dataset.direction = "starboard";
    } else {
      label.textContent = "Straight ahead";
      label.dataset.direction = "straight";
    }
  }

  setExecuteEnabled(enabled) {
    const button = this.element?.querySelector('[data-bfg-action="execute-movement"]');
    if (button) button.disabled = !enabled;
  }

  invalidatePreview(message = "Movement inputs changed. Preview the route again.") {
    if (!this.lastPath) return;
    clearMovementPreview();
    this.lastPath = null;
    this.setExecuteEnabled(false);
    this.updateStatus(message, "normal");
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    if (context.invalid) return;

    const turnSlider = this.element.querySelector('[name="signedTurnDegrees"]');
    if (turnSlider) {
      this.updateTurnSliderLabel();
      turnSlider.addEventListener("input", () => this.updateTurnSliderLabel());
    }
    const secondTurnSlider = this.element.querySelector('[name="secondSignedTurnDegrees"]');
    if (secondTurnSlider) {
      this.updateTurnSliderLabel("secondSignedTurnDegrees", "[data-bfg-second-turn-slider-value]");
      secondTurnSlider.addEventListener("input", () => this.updateTurnSliderLabel("secondSignedTurnDegrees", "[data-bfg-second-turn-slider-value]"));
    }

    const blastMarker = this.element.querySelector('[name="moveThroughBlastMarker"]');
    blastMarker?.addEventListener("change", async () => {
      clearMovementPreview();
      this.lastPath = null;
      this.moveThroughBlastMarker = Boolean(blastMarker.checked);
      await this.render({ force: true });
    });

    for (const input of this.element.querySelectorAll(
      '[name="distanceCm"], [name="beforeTurnCm"], [name="signedTurnDegrees"], [name="beforeSecondTurnCm"], [name="secondSignedTurnDegrees"]'
    )) {
      input.addEventListener("input", () => this.invalidatePreview());
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
        const ram = movementContext.specialOrder?.id === "all-ahead-full"
          ? movementContext.specialOrder.ram
          : null;
        const ramTarget = ram?.passed ? canvas.tokens?.get(ram.targetId) : null;
        if (ramTarget) {
          path.ramContact = findRamContact(token, ramTarget, path.start, path.finalCenter);
          path.ramTargetName = ramTarget.name;
        }
        drawMovementPreview(token, path);
        this.lastPath = path;
        this.setExecuteEnabled(true);

        const turnText = describePath(path);

        this.updateStatus(`Preview: ${turnText}. Final facing ${path.finalRotation.toFixed(0)} degrees.`, "success");
      } catch (error) {
        console.error("BFG Helper | Movement preview failed", error);
        ui.notifications.warn(error.message ?? String(error));
        this.updateStatus(error.message ?? String(error), "error");
      }
    });

    bind('[data-bfg-action="clear-movement-preview"]', async () => {
      clearMovementPreview();
      this.lastPath = null;
      this.setExecuteEnabled(false);
      this.updateStatus("Movement preview cleared.", "normal");
    });

    bind('[data-bfg-action="execute-movement"]', async () => {
      try {
        const token = this.token;
        const executedPath = await executeMovementPath(token, this.lastPath);
        this.lastPath = null;
        this.setExecuteEnabled(false);

        const turnText = describePath(executedPath);

        const ramText = executedPath.ramTargetName
          ? executedPath.ramResolved
            ? ` Ram against ${executedPath.ramTargetName} resolved.`
            : ` Movement stopped at contact with ${executedPath.ramTargetName}; the ram was not applied.`
          : "";
        this.updateStatus(
          `Movement executed: ${turnText}. Final facing ${executedPath.finalRotation.toFixed(0)} degrees.${ramText}`,
          executedPath.ramTargetName && !executedPath.ramResolved ? "error" : "success"
        );
        ui.notifications.info(`${token.name} movement executed.`);
      } catch (error) {
        console.error("BFG Helper | Movement execution failed", error);
        ui.notifications.warn(error.message ?? String(error));
        this.updateStatus(error.message ?? String(error), "error");
      }
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
