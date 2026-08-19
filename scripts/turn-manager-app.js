import {
  PHASES,
  getTurnState,
  getActingFleetIndex,
  nextPhase,
  previousPhase,
  endBattle,
  resetBattle,
  openBattleSetup
} from "./turn-manager.js";
import { getFleetShips, assignSelectedShipToFleet, clearSelectedShipFleet } from "./fleet-assignment.js";
import { lockSelectedShipRotation, unlockSelectedShipRotation } from "./rotation-locking.js";
import { editSelectedShipCombatState, resetSelectedShipCombatState } from "./combat-state.js";
import { editSelectedShipCriticalState } from "./critical-hits.js";
import { openMovementPlanner } from "./movement.js";
import { openShootingPlanner } from "./shooting.js";
import {
  clearAllOrdnanceTrails,
  getOrdnanceMarker,
  launchSelectedShipAttackCraft,
  moveSelectedOrdnance
} from "./ordnance.js";
import { launchSelectedShipTorpedoes, resolveSelectedTorpedoAttack } from "./torpedoes.js";
import { assignSelectedFighterToCAP, resolveSelectedAttackCraft } from "./attack-craft.js";
import { clearAllWeaponArcs, toggleWeaponDialog } from "./weapon-arcs.js";
import { refreshEngines } from "./engine-effects.js";
import {
  declareSelectedShipBoarding,
  resolveSelectedBoarding,
  resolveSelectedPendingHitAndRun,
  resolveSelectedTeleportHitAndRun
} from "./boarding.js";
import { resolveBlastMarkerRemoval, resolveSelectedDamageControl } from "./end-phase.js";
import { assignSelectedSpecialOrder, braceSelectedShip } from "./special-orders.js";
import {
  clearSelectedShipLeadership,
  editSelectedShipLeadership,
  rollAllUnassignedLeadership,
  rollSelectedShipLeadership
} from "./leadership.js";
import { canUserControlActingFleet, getFleetControllerName } from "./fleet-control.js";
import { getShipData } from "./ship-data.js";
import { openFleetStatus } from "./fleet-status-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Persistent Battlefleet Gothic turn tracker.
 *
 * This is an ApplicationV2 window rather than a DialogV2 prompt, so it stays
 * open, remembers its position, can be resized, and re-renders in place when
 * the world turn state changes.
 */
export class BFGTurnManagerApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bfg-helper-turn-manager",
    classes: ["bfg-helper", "bfg-turn-manager-window"],
    tag: "section",
    window: {
      title: "Battlefleet Gothic Turn Manager",
      icon: "fa-solid fa-ship",
      resizable: true,
      minimizable: true
    },
    position: {
      width: 470,
      height: "auto"
    }
  };

  static PARTS = {
    body: {
      template: "modules/bfg-helper/templates/turn-manager.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    this.activeTab = "management";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = getTurnState();
    const actingFleetIndex = getActingFleetIndex(state);
    const activeFleet = state.fleets[actingFleetIndex] ?? null;
    const currentPhase = PHASES.find(phase => phase.id === state.phase) ?? PHASES[0];
    const canAct = canUserControlActingFleet(game.user, state);

    return foundry.utils.mergeObject(context, {
      state,
      battleStatus: state.battleStarted ? "In progress" : "Not started",
      activeFleetName: activeFleet?.name ?? "Unassigned",
      activeFleetLabel: state.phase === "ordnance" ? "Acting fleet" : "Active fleet",
      currentPhaseLabel: currentPhase?.label ?? state.phase,
      managementTab: this.activeTab === "management",
      fleetsTab: this.activeTab === "fleets",
      toolsTab: this.activeTab === "tools",
      movementPhase: state.phase === "movement",
      shootingPhase: state.phase === "shooting",
      ordnancePhase: state.phase === "ordnance",
      endPhase: state.phase === "end",
      canAct,
      actingFleetControllerName: getFleetControllerName(activeFleet),
      phases: PHASES.map(phase => ({
        ...phase,
        active: phase.id === state.phase,
        icon: phase.id === state.phase ? "fa-play" : "fa-circle"
      })),
      fleetCards: state.fleets.map((fleet, index) => {
        const ships = getFleetShips(fleet.id);
        return {
          ...fleet,
          active: index === actingFleetIndex,
          ships,
          hasShips: ships.length > 0,
          shipCount: ships.length,
          controllerName: getFleetControllerName(fleet)
        };
      }),
      canManage: Boolean(game.user?.isGM)
    }, { inplace: false });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const bind = (selector, handler) => {
      const element = this.element.querySelector(selector);
      if (!element) return;
      element.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        await handler(event);
      });
    };

    for (const tab of this.element.querySelectorAll("[data-bfg-tab]")) {
      tab.addEventListener("click", async event => {
        event.preventDefault();
        this.activeTab = tab.dataset.bfgTab;
        await this.render({ force: true });
      });
    }

    bind('[data-bfg-action="move-ship"]', () => openMovementPlanner());
    bind('[data-bfg-action="assign-orders"]', async () => {
      if (await assignSelectedSpecialOrder()) await this.render({ force: true });
    });
    bind('[data-bfg-action="brace-for-impact"]', async () => {
      if (await braceSelectedShip()) await this.render({ force: true });
    });
    bind('[data-bfg-action="declare-boarding"]', () => declareSelectedShipBoarding());
    bind('[data-bfg-action="fire-weaponry"]', () => openShootingPlanner());
    bind('[data-bfg-action="weapon-arcs"]', () => toggleWeaponDialog());
    bind('[data-bfg-action="clear-weapon-arcs"]', () => clearAllWeaponArcs());
    bind('[data-bfg-action="launch-ordnance"]', async () => {
      const selected = canvas.tokens?.controlled ?? [];
      if (selected.length !== 1) {
        ui.notifications.warn("Select exactly one configured ship before launching ordnance.");
        return;
      }
      const token = selected[0];
      const profile = getShipData(token);
      if (!profile) {
        ui.notifications.warn(`${token.name} is not configured as a BFG ship.`);
        return;
      }
      const canLaunchCraft = Array.isArray(profile.attackCraft) && profile.attackCraft.length > 0;
      const canLaunchTorpedoes = (profile.ordnance ?? []).some(item => String(item.type ?? "").toLowerCase() === "torpedo");
      if (!canLaunchCraft && !canLaunchTorpedoes) {
        ui.notifications.warn(`${token.name} has neither launch bays nor torpedo launchers.`);
        return;
      }

      let type = canLaunchCraft ? "attack-craft" : "torpedoes";
      if (canLaunchCraft && canLaunchTorpedoes) {
        const choice = await foundry.applications.api.DialogV2.input({
          window: { title: `Launch Ordnance: ${token.name}` },
          content: `<div class="bfg-dialog"><p>Confirm the single ordnance type to launch.</p><label><input type="checkbox" name="attackCraft"> Attack craft</label><label><input type="checkbox" name="torpedoes"> Torpedoes</label></div>`,
          ok: { label: "Continue", icon: "fa-solid fa-rocket" },
          rejectClose: false,
          modal: true
        });
        if (!choice) return;
        const selectedTypes = [choice.attackCraft && "attack-craft", choice.torpedoes && "torpedoes"].filter(Boolean);
        if (selectedTypes.length !== 1) {
          ui.notifications.warn("Select exactly one ordnance type to launch.");
          return;
        }
        [type] = selectedTypes;
      } else {
        const label = canLaunchCraft ? "attack craft" : "torpedoes";
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: `Launch Ordnance: ${token.name}` },
          content: `<div class="bfg-dialog"><p>${foundry.utils.escapeHTML(token.name)} can launch <strong>${label}</strong>. Confirm this launch type?</p></div>`,
          yes: { label: `Launch ${label}`, icon: "fa-solid fa-rocket" },
          no: { label: "Cancel" },
          modal: true
        });
        if (!confirmed) return;
      }
      if (type === "attack-craft") await launchSelectedShipAttackCraft();
      else await launchSelectedShipTorpedoes();
    });
    bind('[data-bfg-action="open-fleet-status"]', () => openFleetStatus());
    bind('[data-bfg-action="move-ordnance"]', () => moveSelectedOrdnance());
    bind('[data-bfg-action="assign-cap"]', () => assignSelectedFighterToCAP());
    bind('[data-bfg-action="clear-ordnance-paths"]', () => clearAllOrdnanceTrails());
    bind('[data-bfg-action="ordnance-attack"]', async () => {
      const selected = canvas.tokens?.controlled ?? [];
      if (!selected.length) {
        ui.notifications.warn("Select an attack-craft marker or torpedo salvo.");
        return;
      }
      const categories = new Set(selected.map(token => getOrdnanceMarker(token)?.category));
      if (categories.size !== 1 || categories.has(undefined)) {
        ui.notifications.warn("Select only attack craft or exactly one torpedo salvo.");
        return;
      }
      if (categories.has("attackCraft")) await resolveSelectedAttackCraft();
      else if (categories.has("torpedo") && selected.length === 1) await resolveSelectedTorpedoAttack();
      else ui.notifications.warn("Select exactly one torpedo salvo.");
    });
    bind('[data-bfg-action="resolve-boarding"]', () => resolveSelectedBoarding());
    bind('[data-bfg-action="resolve-hit-and-run"]', () => resolveSelectedPendingHitAndRun());
    bind('[data-bfg-action="teleport-hit-and-run"]', () => resolveSelectedTeleportHitAndRun());
    bind('[data-bfg-action="repair-systems"]', async () => {
      if (await resolveSelectedDamageControl()) await this.render({ force: true });
    });
    bind('[data-bfg-action="clear-blast-markers"]', async () => {
      if (await resolveBlastMarkerRemoval()) await this.render({ force: true });
    });

    bind('[data-bfg-action="next"]', async () => {
      if (await nextPhase()) await this.render({ force: true });
    });

    bind('[data-bfg-action="previous"]', async () => {
      if (await previousPhase()) await this.render({ force: true });
    });

    bind('[data-bfg-action="setup"]', async () => {
      await openBattleSetup();
      await this.render({ force: true });
    });

    bind('[data-bfg-action="assign-fleet"]', async () => {
      if (await assignSelectedShipToFleet()) await this.render({ force: true });
    });

    bind('[data-bfg-action="clear-fleet"]', async () => {
      if (await clearSelectedShipFleet()) await this.render({ force: true });
    });

    bind('[data-bfg-action="roll-leadership"]', async () => {
      if (await rollSelectedShipLeadership()) await this.render({ force: true });
    });
    bind('[data-bfg-action="roll-all-leadership"]', async () => {
      await rollAllUnassignedLeadership();
      await this.render({ force: true });
    });
    bind('[data-bfg-action="edit-leadership"]', async () => {
      if (await editSelectedShipLeadership()) await this.render({ force: true });
    });
    bind('[data-bfg-action="clear-leadership"]', async () => {
      if (await clearSelectedShipLeadership()) await this.render({ force: true });
    });

    bind('[data-bfg-action="lock-selected-rotation"]', async () => {
      await lockSelectedShipRotation();
    });

    bind('[data-bfg-action="unlock-selected-rotation"]', async () => {
      await unlockSelectedShipRotation();
    });

    bind('[data-bfg-action="edit-combat-state"]', async () => {
      if (await editSelectedShipCombatState()) await this.render({ force: true });
    });

    bind('[data-bfg-action="reset-combat-state"]', async () => {
      if (await resetSelectedShipCombatState()) await this.render({ force: true });
    });

    bind('[data-bfg-action="edit-critical-state"]', async () => {
      if (await editSelectedShipCriticalState()) await this.render({ force: true });
    });

    bind('[data-bfg-action="refresh-engines"]', () => refreshEngines());

    bind('[data-bfg-action="end"]', async () => {
      if (await endBattle()) await this.render({ force: true });
    });

    bind('[data-bfg-action="reset"]', async () => {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Reset Battle and Restore Ships" },
        content: "<p>Reset the battle round, fleet names, active fleet and phase, restore every configured ship to full hits and shields, and clear critical effects? Deployed ship assignments will be retained.</p>",
        yes: { label: "Reset and Restore", icon: "fa-solid fa-rotate-left" },
        no: { label: "Cancel", icon: "fa-solid fa-xmark" },
        rejectClose: false,
        modal: true
      });

      if (confirmed && await resetBattle()) {
        await this.render({ force: true });
      }
    });
  }
}

let turnManagerApplication = null;

export function getTurnManagerApplication() {
  turnManagerApplication ??= new BFGTurnManagerApplication();
  return turnManagerApplication;
}

export async function openTurnManagerApplication() {
  const app = getTurnManagerApplication();
  await app.render({ force: true });
  return app;
}

/** Re-render the open tracker when the shared world state changes. */
export function refreshTurnManagerApplication() {
  if (!turnManagerApplication?.rendered) return;
  turnManagerApplication.render({ force: true });
}
