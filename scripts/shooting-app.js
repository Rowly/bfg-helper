import {
  getSelectedShootingTarget,
  getShootingContext,
  previewDirectFire
} from "./shooting.js";
import { clearWeaponArc } from "./weapon-arcs.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BFGShootingPlannerApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bfg-helper-shooting-planner",
    classes: ["bfg-helper", "bfg-shooting-planner-window"],
    tag: "section",
    window: {
      title: "Battlefleet Gothic Shooting Planner",
      icon: "fa-solid fa-crosshairs",
      resizable: true,
      minimizable: true
    },
    position: { width: 460, height: "auto" }
  };

  static PARTS = {
    body: { template: "modules/bfg-helper/templates/shooting-planner.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.tokenId = null;
    this.sceneId = null;
    this.analysis = null;
    this.weaponIndex = 0;
  }

  setToken(token) {
    if (this.token) clearWeaponArc(this.token);
    this.tokenId = token?.id ?? null;
    this.sceneId = canvas.scene?.id ?? null;
    this.analysis = null;
    this.weaponIndex = 0;
  }

  get token() {
    if (!this.tokenId || this.sceneId !== canvas.scene?.id) return null;
    return canvas.tokens?.get(this.tokenId) ?? null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const shooting = getShootingContext(this.token);
    if (!shooting.ok) {
      return foundry.utils.mergeObject(context, {
        invalid: true,
        error: shooting.error
      }, { inplace: false });
    }

    const target = getSelectedShootingTarget();
    const analysis = this.analysis
      ? {
          targetName: this.analysis.targetName,
          weaponType: this.analysis.weaponType,
          rangeLabel: this.analysis.rangeLabel,
          maximumRangeCm: this.analysis.maximumRangeCm,
          inRange: this.analysis.inRange,
          inArc: this.analysis.inArc,
          targetFacing: this.analysis.targetFacing,
          targetCombatState: this.analysis.targetCombatState,
          warnings: this.analysis.warnings,
          legal: this.analysis.legal
        }
      : null;
    return foundry.utils.mergeObject(context, {
      invalid: false,
      tokenName: shooting.token.name,
      shipClass: shooting.shipData.shipClass ?? shooting.actor?.name ?? "Configured ship",
      fleetName: shooting.fleet?.name ?? "Unassigned",
      activeFleetName: shooting.activeFleet?.name ?? "None",
      weapons: shooting.weapons.map((weapon, index) => ({
        index,
        name: weapon.name,
        rangeCm: weapon.rangeCm,
        arcDegrees: weapon.arcDegrees,
        strength: weapon.strength ?? "-",
        selected: index === this.weaponIndex
      })),
      targetName: target?.name ?? "No target selected",
      hasTarget: Boolean(target),
      hasWarnings: shooting.warnings.length > 0,
      warnings: shooting.warnings,
      analysis,
      hasAnalysis: Boolean(analysis)
    }, { inplace: false });
  }

  updateStatus(message, type = "normal") {
    const element = this.element?.querySelector("[data-bfg-shooting-status]");
    if (!element) return;
    element.textContent = message;
    element.dataset.status = type;
  }

  async refreshTarget() {
    this.analysis = null;
    if (this.token) clearWeaponArc(this.token);
    await this.render({ force: true });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (context.invalid) return;

    const weaponSelect = this.element.querySelector('[name="weaponIndex"]');
    weaponSelect?.addEventListener("change", () => {
      this.weaponIndex = Number(weaponSelect.value ?? 0);
      this.analysis = null;
      clearWeaponArc(this.token);
      this.updateStatus("Weapon changed. Check the firing solution again.");
    });

    const bind = (selector, handler) => {
      const element = this.element.querySelector(selector);
      if (!element) return;
      element.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        await handler(event);
      });
    };

    bind('[data-bfg-action="refresh-target"]', () => this.refreshTarget());

    bind('[data-bfg-action="check-firing-solution"]', async () => {
      try {
        const shooting = getShootingContext(this.token);
        if (!shooting.ok) throw new Error(shooting.error);
        const target = getSelectedShootingTarget();
        if (!target) throw new Error("Target exactly one ship, then refresh or check the firing solution.");

        this.weaponIndex = Number(weaponSelect?.value ?? this.weaponIndex);
        const weapon = shooting.weapons[this.weaponIndex];
        if (!weapon) throw new Error("Select a valid direct-fire weapon.");
        const analysis = previewDirectFire(this.token, target, weapon);
        this.analysis = analysis;

        const legalForUser = analysis.legal || game.user?.isGM;
        const result = [
          `${analysis.rangeLabel} cm / ${analysis.maximumRangeCm} cm`,
          analysis.inRange ? "in range" : "out of range",
          analysis.inArc ? "in arc" : "outside arc",
          `${analysis.targetFacing} facing`
        ].join("; ");
        await this.render({ force: true });
        this.updateStatus(
          `${legalForUser ? "Firing solution" : "Illegal target"}: ${result}.`,
          analysis.legal ? "success" : "error"
        );
      } catch (error) {
        console.error("BFG Helper | Shooting preview failed", error);
        ui.notifications.warn(error.message ?? String(error));
        this.updateStatus(error.message ?? String(error), "error");
      }
    });

    bind('[data-bfg-action="clear-firing-solution"]', async () => {
      clearWeaponArc(this.token);
      this.analysis = null;
      await this.render({ force: true });
    });
  }

  async close(options = {}) {
    if (this.token) clearWeaponArc(this.token);
    this.analysis = null;
    return super.close(options);
  }
}

let shootingPlannerApplication = null;

export function getShootingPlannerApplication() {
  shootingPlannerApplication ??= new BFGShootingPlannerApplication();
  return shootingPlannerApplication;
}

export async function openShootingPlannerApplication(token) {
  const app = getShootingPlannerApplication();
  app.setToken(token);
  await app.render({ force: true });
  return app;
}
