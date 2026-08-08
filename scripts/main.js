import { configureSelectedShip, getShipData, setShipData } from "./ship-data.js";
import { retributionProfile, despoilerProfile } from "./ship-profiles/index.js";
import { toggleWeaponDialog, clearAllWeaponArcs, clearWeaponArc } from "./weapon-arcs.js";
import { createEngine, refreshEngines, initialiseEngineTicker, clearAllEngines, removeEngine } from "./engine-effects.js";
import { openMovementPlanner, previewSelectedShipMovement, clearMovementPreview } from "./movement.js";
import { registerTurnManagerSettings, turnManager } from "./turn-manager.js";
import {
  assignSelectedShipToFleet,
  clearSelectedShipFleet,
  getFleetShips,
  getTokenFleetId,
  migrateActorFleetAssignmentsToTokens
} from "./fleet-assignment.js";

Hooks.once("init", () => {
  console.log("BFG Helper | Initialising");
  registerTurnManagerSettings();
});

async function configureProfile(profileFactory) {
  const ok = await configureSelectedShip(profileFactory());
  if (ok) {
    const token = canvas.tokens.controlled[0];
    if (token) createEngine(token);
  }
  return ok;
}

Hooks.once("ready", () => {
  game.bfgHelper = {
    configureSelectedShip,
    configureRetribution: () => configureProfile(retributionProfile),
    configureDespoiler: () => configureProfile(despoilerProfile),
    profiles: {
      retribution: retributionProfile,
      despoiler: despoilerProfile
    },
    getShipData,
    setShipData,
    fleets: {
      assign: assignSelectedShipToFleet,
      clearAssignment: clearSelectedShipFleet,
      getShips: getFleetShips,
      getTokenFleetId
    },
    weaponArcs: {
      toggle: toggleWeaponDialog,
      clear: clearWeaponArc,
      clearAll: clearAllWeaponArcs
    },
    engines: {
      create: createEngine,
      refresh: refreshEngines,
      clearAll: clearAllEngines
    },
    movement: {
      move: openMovementPlanner,
      open: openMovementPlanner,
      preview: previewSelectedShipMovement,
      clearPreview: clearMovementPreview
    },
    turnManager
  };
  console.log("BFG Helper | API available as game.bfgHelper");
});

Hooks.on("bfgHelperTurnStateChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
});

Hooks.on("bfgHelperFleetAssignmentsChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
});

Hooks.on("canvasReady", async () => {
  initialiseEngineTicker();
  refreshEngines();
  await migrateActorFleetAssignmentsToTokens();
  Hooks.callAll("bfgHelperFleetAssignmentsChanged");
});

Hooks.on("deleteToken", (tokenDocument) => {
  removeEngine(tokenDocument);
});

Hooks.on("canvasTearDown", () => {
  clearAllWeaponArcs();
  clearAllEngines();
  clearMovementPreview();
});
