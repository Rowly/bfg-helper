import { PHASES, getActingFleetIndex, getTurnState } from "./turn-manager.js";
import { getFleetShips } from "./fleet-assignment.js";
import { getFleetControllerName } from "./fleet-control.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BFGFleetStatusApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bfg-helper-fleet-status",
    classes: ["bfg-helper", "bfg-fleet-status-window"],
    tag: "section",
    window: {
      title: "Battlefleet Gothic Fleet Status",
      icon: "fa-solid fa-table-list",
      resizable: true,
      minimizable: true
    },
    position: { width: 1050, height: "auto" }
  };

  static PARTS = {
    body: { template: "modules/bfg-helper/templates/fleet-status.hbs" }
  };

  constructor(options = {}) {
    super(options);
    this.hasAutoPositioned = false;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = getTurnState();
    const actingFleetIndex = getActingFleetIndex(state);
    const phase = PHASES.find(item => item.id === state.phase);
    return foundry.utils.mergeObject(context, {
      state,
      phaseLabel: phase?.label ?? state.phase,
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
      })
    }, { inplace: false });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.hasAutoPositioned) return;
    this.hasAutoPositioned = true;
    requestAnimationFrame(() => {
      if (!this.rendered) return;
      const width = Math.min(1500, Math.max(680, window.innerWidth - 32));
      this.setPosition({ width, height: "auto", left: Math.max(16, (window.innerWidth - width) / 2) });
      requestAnimationFrame(() => {
        if (!this.rendered) return;
        const height = this.element?.getBoundingClientRect?.().height ?? 0;
        this.setPosition({ top: Math.max(16, window.innerHeight - height - 48) });
      });
    });
  }
}

let fleetStatusApplication = null;

export function getFleetStatusApplication() {
  fleetStatusApplication ??= new BFGFleetStatusApplication();
  return fleetStatusApplication;
}

export async function openFleetStatus() {
  const app = getFleetStatusApplication();
  await app.render({ force: true });
  return app;
}

export function refreshFleetStatusApplication() {
  if (fleetStatusApplication?.rendered) fleetStatusApplication.render({ force: true });
}
