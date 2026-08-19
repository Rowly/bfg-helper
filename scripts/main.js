import { configureSelectedShip, getShipData, setShipData } from "./ship-data.js";
import { MODULE_ID } from "./constants.js";
import {
  acheronProfile,
  carnageProfile,
  despoilerProfile,
  dominatorProfile,
  gothicProfile,
  hadesProfile,
  idolatorProfile,
  lunarProfile,
  murderProfile,
  retributionProfile,
  slaughterProfile,
  styxProfile,
  swordProfile,
  tyrantProfile
} from "./ship-profiles/index.js";
import {
  toggleWeaponDialog,
  clearAllWeaponArcs,
  clearWeaponArc,
  initialiseWeaponArcSocket,
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
import {
  editSelectedShipCombatState,
  getCombatState,
  initialiseBattleCombatStates,
  resetSelectedShipCombatState,
  setCombatState
} from "./combat-state.js";
import {
  analyseDirectFire,
  commitDirectFireDamage,
  getShootingContext,
  openShootingPlanner,
  previewDirectFire,
  resolveDirectFire
} from "./shooting.js";
import { openNovaCannon } from "./nova-cannon.js";
import { editSelectedShipCriticalState, getCriticalState, setCriticalState } from "./critical-hits.js";
import { getCatastrophicState, setCatastrophicState } from "./catastrophic-damage.js";
import {
  getOrdnanceMarker,
  getOrdnanceState,
  clearAllOrdnanceTrails,
  clearOrdnanceMovementPreview,
  initialiseOrdnanceControls,
  validateAttackCraftDrag,
  completeAttackCraftDrag,
  refreshAttackCraftArtwork,
  captureCAPShipMovement,
  completeCAPShipMovement,
  launchSelectedShipAttackCraft,
  moveSelectedOrdnance,
  reloadSelectedShipOrdnance
} from "./ordnance.js";
import {
  launchSelectedShipTorpedoes,
  refreshTorpedoMarkerArtwork,
  resolveSelectedTorpedoAttack
} from "./torpedoes.js";
import { assignSelectedFighterToCAP, resolveSelectedAttackCraft } from "./attack-craft.js";
import {
  declareSelectedShipBoarding,
  getBoardingState,
  resolveSelectedBoarding,
  resolveSelectedPendingHitAndRun,
  resolveSelectedTeleportHitAndRun
} from "./boarding.js";
import { resolveBlastMarkerRemoval, resolveSelectedDamageControl } from "./end-phase.js";
import { initialiseQuantitySteppers } from "./quantity-stepper.js";
import { assignSelectedSpecialOrder, braceSelectedShip, getSpecialOrder } from "./special-orders.js";
import {
  clearSelectedShipLeadership,
  editSelectedShipLeadership,
  getBaseLeadership,
  getEffectiveLeadership,
  getLeadership,
  rollAllUnassignedLeadership,
  rollSelectedShipLeadership,
  setLeadership
} from "./leadership.js";
import { clearAllShootingEffects, initialiseShootingEffectSocket, registerShootingEffectSettings } from "./shooting-effects.js";
import {
  enforceFleetTokenControl,
  preventUnauthorizedFleetTokenUpdate,
  syncAllFleetTokenOwnership,
  syncFleetTokenOwnership
} from "./fleet-control.js";
import { openFleetStatus, refreshFleetStatusApplication } from "./fleet-status-app.js";

Hooks.once("init", () => {
  console.log("BFG Helper | Initialising");
  registerTurnManagerSettings();
  registerShootingEffectSettings();
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
  initialiseShootingEffectSocket();
  initialiseWeaponArcSocket();
  initialiseOrdnanceControls();
  initialiseQuantitySteppers();
  game.bfgHelper = {
    configureSelectedShip,
    configureRetribution: () => configureProfile(retributionProfile),
    configureDespoiler: () => configureProfile(despoilerProfile),
    configureSword: () => configureProfile(swordProfile),
    configureIdolator: () => configureProfile(idolatorProfile),
    configureDominator: () => configureProfile(dominatorProfile),
    configureCarnage: () => configureProfile(carnageProfile),
    configureMurder: () => configureProfile(murderProfile),
    configureSlaughter: () => configureProfile(slaughterProfile),
    configureAcheron: () => configureProfile(acheronProfile),
    configureHades: () => configureProfile(hadesProfile),
    configureStyx: () => configureProfile(styxProfile),
    configureLunar: () => configureProfile(lunarProfile),
    configureGothic: () => configureProfile(gothicProfile),
    configureTyrant: () => configureProfile(tyrantProfile),
    profiles: {
      retribution: retributionProfile,
      despoiler: despoilerProfile,
      sword: swordProfile,
      idolator: idolatorProfile,
      dominator: dominatorProfile,
      carnage: carnageProfile,
      murder: murderProfile,
      slaughter: slaughterProfile,
      acheron: acheronProfile,
      hades: hadesProfile,
      styx: styxProfile,
      lunar: lunarProfile,
      gothic: gothicProfile,
      tyrant: tyrantProfile
    },
    getShipData,
    setShipData,
    fleets: {
      assign: assignSelectedShipToFleet,
      clearAssignment: clearSelectedShipFleet,
      getShips: getFleetShips,
      getTokenFleetId
    },
    fleetStatus: {
      open: openFleetStatus,
      refresh: refreshFleetStatusApplication
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
    combat: {
      getState: getCombatState,
      setState: setCombatState,
      editSelected: editSelectedShipCombatState,
      resetSelected: resetSelectedShipCombatState
    },
    criticals: {
      getState: getCriticalState,
      setState: setCriticalState,
      editSelected: editSelectedShipCriticalState
    },
    catastrophicDamage: {
      getState: getCatastrophicState,
      setState: setCatastrophicState
    },
    endPhase: {
      getBoardingState,
      declareBoarding: declareSelectedShipBoarding,
      resolveBoarding: resolveSelectedBoarding,
      resolveHitAndRun: resolveSelectedPendingHitAndRun,
      teleportHitAndRun: resolveSelectedTeleportHitAndRun,
      repairSystems: resolveSelectedDamageControl,
      clearBlastMarkers: resolveBlastMarkerRemoval
    },
    specialOrders: {
      assign: assignSelectedSpecialOrder,
      brace: braceSelectedShip,
      get: getSpecialOrder
    },
    leadership: {
      get: getLeadership,
      getBase: getBaseLeadership,
      getEffective: getEffectiveLeadership,
      set: setLeadership,
      rollSelected: rollSelectedShipLeadership,
      rollAllUnassigned: rollAllUnassignedLeadership,
      editSelected: editSelectedShipLeadership,
      clearSelected: clearSelectedShipLeadership
    },
    shooting: {
      open: openShootingPlanner,
      getContext: getShootingContext,
      analyse: analyseDirectFire,
      preview: previewDirectFire,
      resolve: resolveDirectFire,
      commitDamage: commitDirectFireDamage,
      fireNovaCannon: openNovaCannon
    },
    shootingEffects: {
      clear: clearAllShootingEffects
    },
    ordnance: {
      getMarker: getOrdnanceMarker,
      getState: getOrdnanceState,
      clearTrails: clearAllOrdnanceTrails,
      launchAttackCraft: launchSelectedShipAttackCraft,
      launchTorpedoes: launchSelectedShipTorpedoes,
      move: moveSelectedOrdnance,
      resolveTorpedoAttack: resolveSelectedTorpedoAttack,
      resolveAttackCraft: resolveSelectedAttackCraft,
      assignFighterCAP: assignSelectedFighterToCAP,
      reloadSelected: reloadSelectedShipOrdnance
    },
    turnManager
  };
  console.log("BFG Helper | API available as game.bfgHelper");
});

Hooks.on("bfgHelperTurnStateChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  const { refreshShootingPlannerApplication } = await import("./shooting-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
  refreshShootingPlannerApplication({ clear: true });
});

Hooks.on("bfgHelperFleetAssignmentsChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
});

Hooks.on("bfgHelperCombatStateChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
});

Hooks.on("bfgHelperCriticalStateChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
});

Hooks.on("bfgHelperCatastrophicStateChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
});

Hooks.on("bfgHelperPendingActionsChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
});

Hooks.on("bfgHelperSpecialOrdersChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
});

Hooks.on("bfgHelperLeadershipChanged", async () => {
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
});

Hooks.on("targetToken", async (user) => {
  if (user?.id !== game.user?.id) return;
  const { refreshShootingPlannerTarget } = await import("./shooting-app.js");
  await refreshShootingPlannerTarget();
});

function hasBFGHelperFlagChanges(changes) {
  const flattened = foundry.utils.flattenObject(changes ?? {});
  const prefix = `flags.${MODULE_ID}`;
  return Object.keys(flattened).some(key => key === prefix || key.startsWith(`${prefix}.`));
}

async function refreshTurnManagerForTokenStateChange(_tokenDocument, changes) {
  if (!hasBFGHelperFlagChanges(changes)) return;
  const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
  refreshTurnManagerApplication();
  refreshFleetStatusApplication();
}

Hooks.on("preUpdateToken", preventLockedTokenRotation);
Hooks.on("preUpdateToken", preventUnauthorizedFleetTokenUpdate);
Hooks.on("preUpdateToken", validateAttackCraftDrag);
Hooks.on("preUpdateToken", captureCAPShipMovement);
Hooks.on("updateToken", completeAttackCraftDrag);
Hooks.on("updateToken", completeCAPShipMovement);
Hooks.on("updateToken", refreshTurnManagerForTokenStateChange);
Hooks.on("controlToken", enforceFleetTokenControl);

Hooks.on("canvasReady", async () => {
  initialiseWeaponArcTicker();
  initialiseEngineTicker();
  refreshEngines();
  await migrateActorFleetAssignmentsToTokens();
  if (game.user?.isGM) {
    await refreshAttackCraftArtwork();
    await refreshTorpedoMarkerArtwork();
    await setBattleShipRotationLocks(getTurnState().battleStarted);
    await initialiseBattleCombatStates();
    await syncAllFleetTokenOwnership(getTurnState());
  }
  Hooks.callAll("bfgHelperFleetAssignmentsChanged");
});

Hooks.on("deleteToken", (tokenDocument) => {
  clearWeaponArc(tokenDocument);
  removeEngine(tokenDocument);
  if (getTokenFleetId(tokenDocument)) {
    import("./turn-manager-app.js").then(({ refreshTurnManagerApplication }) => refreshTurnManagerApplication());
    refreshFleetStatusApplication();
  }
});

Hooks.on("createToken", async tokenDocument => {
  if (game.user?.isGM && getTurnState().battleStarted) {
    await syncFleetTokenOwnership(tokenDocument, getTurnState());
  }
  if (getTokenFleetId(tokenDocument)) {
    const { refreshTurnManagerApplication } = await import("./turn-manager-app.js");
    refreshTurnManagerApplication();
    refreshFleetStatusApplication();
  }
});

Hooks.on("canvasTearDown", () => {
  clearAllWeaponArcs({ broadcast: false, notify: false });
  clearAllEngines();
  clearMovementPreview();
  clearOrdnanceMovementPreview();
  clearAllOrdnanceTrails({ notify: false, broadcast: false });
  clearAllShootingEffects();
});
