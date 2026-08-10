import { configureSelectedShip, getShipData, setShipData } from "./ship-data.js";
import { retributionProfile, despoilerProfile } from "./ship-profiles/index.js";
import {
  toggleWeaponDialog,
  clearAllWeaponArcs,
  clearWeaponArc,
  initialiseWeaponArcTicker
} from "./weapon-arcs.js";
import { createEngine, refreshEngines, initialiseEngineTicker, clearAllEngines, removeEngine } from "./engine-effects.js";
import {
  openMovementPlanner,
  previewSelectedShipMovement,
  executeSelectedShipMovement,
  clearMovementPreview
} from "./movement.js";
import { getTurnState, registerTurnManagerSettings, turnManager } from "./turn-manager.js";
import {
  lockSelectedShipRotation,
  preventLockedTokenRotation,
  setBattleShipRotationLocks,
  syncTokenRotationLock,
  unlockSelectedShipRotation
} from "./rotation-locking.js";
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
    if (token) {
      createEngine(token);
      await syncTokenRotationLock(token, getTurnState().battleStarted);
    }
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
      execute: executeSelectedShipMovement,
      clearPreview: clearMovementPreview
    },
    rotation: {
      lockBattleShips: () => setBattleShipRotationLocks(true),
      unlockBattleShips: () => setBattleShipRotationLocks(false),
      lockSelected: lockSelectedShipRotation,
      unlockSelected: unlockSelectedShipRotation
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

Hooks.on("preUpdateToken", preventLockedTokenRotation);

Hooks.on("canvasReady", async () => {
  initialiseWeaponArcTicker();
  initialiseEngineTicker();
  refreshEngines();
  await migrateActorFleetAssignmentsToTokens();
  if (game.user?.isGM) {
    await setBattleShipRotationLocks(getTurnState().battleStarted);
  }
  Hooks.callAll("bfgHelperFleetAssignmentsChanged");
});

Hooks.on("deleteToken", (tokenDocument) => {
  clearWeaponArc(tokenDocument);
  removeEngine(tokenDocument);
});

Hooks.on("canvasTearDown", () => {
  clearAllWeaponArcs();
  clearAllEngines();
  clearMovementPreview();
});
