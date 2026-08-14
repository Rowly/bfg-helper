import {
  getSelectedShootingTarget,
  getShootingContext,
  previewDirectFire,
  resolveDirectFire,
  commitDirectFireDamage,
  hasWeaponFired
} from "./shooting.js";
import { clearWeaponArc } from "./weapon-arcs.js";
import { calculateBatteryDice } from "./gunnery-table.js";
import { isWeaponDisabledByCritical } from "./critical-hits.js";

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
    this.resolution = null;
    this.damageCommitted = false;
    this.interveningBlastMarkers = false;
    this.countsAsDefences = false;
    this.isRolling = false;
  }

  setToken(token) {
    if (this.token) clearWeaponArc(this.token);
    this.tokenId = token?.id ?? null;
    this.sceneId = canvas.scene?.id ?? null;
    this.analysis = null;
    this.weaponIndex = 0;
    this.resolution = null;
    this.damageCommitted = false;
    this.interveningBlastMarkers = false;
    this.countsAsDefences = false;
    this.isRolling = false;
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
    const gunneryCalculation = this.analysis?.weapon?.type === "battery"
      ? calculateBatteryDice({
          firepower: this.analysis.effectiveStrength,
          targetClass: this.analysis.targetClass,
          orientation: this.analysis.orientation,
          rangeCm: this.analysis.rangeCm,
          interveningBlastMarkers: this.interveningBlastMarkers,
          countsAsDefences: this.analysis.isOrdnance ? false : this.countsAsDefences,
          ignoreLongRangeShift: Boolean(this.analysis.weapon.ignoreLongRangeShift)
        })
      : null;
    const previewAttackDice = gunneryCalculation?.attackDice
      ?? (this.analysis?.weapon?.type === "lance" ? this.analysis.effectiveStrength : null);
    const shiftLabel = calculation => calculation?.shifts
      .map(shift => `${shift.direction}: ${shift.reason}`)
      .join("; ") || "None";
    const analysis = this.analysis
      ? {
          targetName: this.analysis.targetName,
          weaponType: this.analysis.weaponType,
          profileStrength: this.analysis.profileStrength,
          effectiveStrength: this.analysis.effectiveStrength,
          attackerCrippled: this.analysis.attackerCrippled,
          rangeLabel: this.analysis.rangeLabel,
          maximumRangeCm: this.analysis.maximumRangeCm,
          inRange: this.analysis.inRange,
          inArc: this.analysis.inArc,
          targetFacing: this.analysis.targetFacing,
          targetArmour: this.analysis.targetArmour,
          orientation: this.analysis.orientation,
          targetClass: this.analysis.targetClass,
          weaponFired: this.analysis.weaponFired,
          weaponDisabled: this.analysis.weaponDisabled,
          attackDice: previewAttackDice,
          gunneryCalculation: gunneryCalculation
            ? { ...gunneryCalculation, shiftsLabel: shiftLabel(gunneryCalculation) }
            : null,
          targetCombatState: this.analysis.targetCombatState,
          warnings: this.analysis.warnings,
          legal: this.analysis.legal
        }
      : null;
    const resolution = this.resolution
      ? {
          ...this.resolution,
          resultsLabel: this.resolution.results.join(", ") || "No dice",
          criticalChecksLabel: this.resolution.damage?.critical?.checkResults?.join(", ") || "None",
          catastrophicRangeLabel: this.resolution.damage?.catastrophic?.explosionRangeDice?.join(", ") || "None",
          shiftsLabel: shiftLabel(this.resolution.batteryCalculation)
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
        type: String(weapon.type ?? "Direct fire")
          .replace(/^./, character => character.toUpperCase()),
        rangeCm: weapon.rangeCm,
        arcDegrees: weapon.arcDegrees,
        strength: shooting.combatState?.crippled
          ? Math.ceil(Number(weapon.strength ?? 0) / 2)
          : weapon.strength ?? "-",
        fired: hasWeaponFired(shooting.token, weapon.id, shooting.state),
        criticallyDisabled: isWeaponDisabledByCritical(weapon, shooting.criticalState),
        selected: index === this.weaponIndex
      })),
      targetName: target?.name ?? "No target selected",
      hasTarget: Boolean(target),
      hasWarnings: shooting.warnings.length > 0,
      warnings: shooting.warnings,
      analysis,
      hasAnalysis: Boolean(analysis),
      canResolveAttack: Boolean(analysis?.legal && !resolution),
      resolution,
      hasResolution: Boolean(resolution),
      isRolling: this.isRolling,
      canCommitDamage: Boolean(resolution && game.user?.isGM && !this.damageCommitted),
      damageCommitted: this.damageCommitted,
      interveningBlastMarkers: this.interveningBlastMarkers,
      countsAsDefences: this.countsAsDefences
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
    this.resolution = null;
    this.damageCommitted = false;
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
      this.resolution = null;
      this.damageCommitted = false;
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
        if (!target) throw new Error("Target exactly one ship or ordnance marker, then refresh or check the firing solution.");

        this.weaponIndex = Number(weaponSelect?.value ?? this.weaponIndex);
        const weapon = shooting.weapons[this.weaponIndex];
        if (!weapon) throw new Error("Select a valid direct-fire weapon.");
        const analysis = previewDirectFire(this.token, target, weapon);
        this.analysis = analysis;
        this.resolution = null;
        this.damageCommitted = false;

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

    for (const name of ["interveningBlastMarkers", "countsAsDefences"]) {
      const input = this.element.querySelector(`[name="${name}"]`);
      input?.addEventListener("change", async () => {
        this[name] = Boolean(input.checked);
        this.resolution = null;
        this.damageCommitted = false;
        await this.render({ force: true });
      });
    }

    bind('[data-bfg-action="resolve-direct-fire"]', async () => {
      try {
        if (!this.analysis) throw new Error("Check a firing solution before rolling.");
        this.interveningBlastMarkers = Boolean(
          this.element.querySelector('[name="interveningBlastMarkers"]')?.checked
        );
        this.countsAsDefences = Boolean(
          this.element.querySelector('[name="countsAsDefences"]')?.checked
        );
        this.isRolling = true;
        await this.render({ force: true });
        [this.resolution] = await Promise.all([
          resolveDirectFire(this.analysis, {
            interveningBlastMarkers: this.interveningBlastMarkers,
            countsAsDefences: this.countsAsDefences
          }),
          new Promise(resolve => setTimeout(resolve, 600))
        ]);
        this.isRolling = false;
        this.damageCommitted = false;
        await this.render({ force: true });
        this.updateStatus(
          `Attack rolled: ${this.resolution.hits} hit${this.resolution.hits === 1 ? "" : "s"}. Review the result before confirming.`,
          "success"
        );
      } catch (error) {
        this.isRolling = false;
        await this.render({ force: true });
        console.error("BFG Helper | Shooting resolution failed", error);
        ui.notifications.warn(error.message ?? String(error));
        this.updateStatus(error.message ?? String(error), "error");
      }
    });

    bind('[data-bfg-action="commit-direct-fire-damage"]', async () => {
      try {
        if (!this.resolution) throw new Error("Roll an attack before committing damage.");
        await commitDirectFireDamage(this.resolution);
        this.damageCommitted = true;
        await this.render({ force: true });
        this.updateStatus(this.resolution.isOrdnance ? "Ordnance result confirmed." : "Damage committed to the target ship.", "success");
      } catch (error) {
        console.error("BFG Helper | Damage commit failed", error);
        ui.notifications.warn(error.message ?? String(error));
        this.updateStatus(error.message ?? String(error), "error");
      }
    });

    bind('[data-bfg-action="clear-firing-solution"]', async () => {
      clearWeaponArc(this.token);
      this.analysis = null;
      this.resolution = null;
      this.damageCommitted = false;
      await this.render({ force: true });
    });
  }

  async close(options = {}) {
    if (this.token) clearWeaponArc(this.token);
    this.analysis = null;
    this.resolution = null;
    this.damageCommitted = false;
    this.isRolling = false;
    return super.close(options);
  }
}

let shootingPlannerApplication = null;

export function getShootingPlannerApplication() {
  shootingPlannerApplication ??= new BFGShootingPlannerApplication();
  return shootingPlannerApplication;
}

export async function refreshShootingPlannerApplication({ clear = false } = {}) {
  if (!shootingPlannerApplication?.rendered) return false;
  if (clear) {
    shootingPlannerApplication.analysis = null;
    shootingPlannerApplication.resolution = null;
    shootingPlannerApplication.damageCommitted = false;
  }
  await shootingPlannerApplication.render({ force: true });
  return true;
}

export async function refreshShootingPlannerTarget() {
  if (!shootingPlannerApplication?.rendered) return false;
  await shootingPlannerApplication.refreshTarget();
  return true;
}

export async function openShootingPlannerApplication(token) {
  const app = getShootingPlannerApplication();
  app.setToken(token);
  await app.render({ force: true });
  return app;
}
