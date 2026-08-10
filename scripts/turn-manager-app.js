import {
  PHASES,
  getTurnState,
  nextPhase,
  previousPhase,
  endBattle,
  resetBattle,
  openBattleSetup
} from "./turn-manager.js";
import { getFleetShips, assignSelectedShipToFleet, clearSelectedShipFleet } from "./fleet-assignment.js";
import { lockSelectedShipRotation, unlockSelectedShipRotation } from "./rotation-locking.js";
import { editSelectedShipCombatState, resetSelectedShipCombatState } from "./combat-state.js";

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

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = getTurnState();
    const activeFleet = state.fleets[state.activeFleetIndex] ?? null;
    const currentPhase = PHASES.find(phase => phase.id === state.phase) ?? PHASES[0];

    return foundry.utils.mergeObject(context, {
      state,
      battleStatus: state.battleStarted ? "In progress" : "Not started",
      activeFleetName: activeFleet?.name ?? "Unassigned",
      currentPhaseLabel: currentPhase?.label ?? state.phase,
      phases: PHASES.map(phase => ({
        ...phase,
        active: phase.id === state.phase,
        icon: phase.id === state.phase ? "fa-play" : "fa-circle"
      })),
      fleetCards: state.fleets.map((fleet, index) => {
        const ships = getFleetShips(fleet.id);
        return {
          ...fleet,
          active: index === state.activeFleetIndex,
          ships,
          hasShips: ships.length > 0,
          shipCount: ships.length
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

    bind('[data-bfg-action="end"]', async () => {
      if (await endBattle()) await this.render({ force: true });
    });

    bind('[data-bfg-action="reset"]', async () => {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Reset Battle and Restore Ships" },
        content: "<p>Reset the battle round, fleet names, active fleet and phase, and restore every configured ship to full hits and shields? Deployed ship assignments will be retained.</p>",
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
