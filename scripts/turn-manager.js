import { MODULE_ID } from "./constants.js";
import { setBattleShipRotationLocks } from "./rotation-locking.js";
import { initialiseBattleCombatStates, resetAllCombatStates } from "./combat-state.js";

export const TURN_STATE_KEY = "turnState";

export const PHASES = Object.freeze([
  { id: "movement", label: "Movement" },
  { id: "shooting", label: "Shooting" },
  { id: "ordnance", label: "Ordnance" },
  { id: "end", label: "End Phase" }
]);

function defaultState() {
  return {
    battleStarted: false,
    battleId: null,
    round: 1,
    fleets: [
      { id: "fleet-a", name: "Fleet A", ownerUserId: null },
      { id: "fleet-b", name: "Fleet B", ownerUserId: null }
    ],
    activeFleetIndex: 0,
    ordnanceFleetIndex: null,
    phase: "movement"
  };
}

export function registerTurnManagerSettings() {
  game.settings.register(MODULE_ID, TURN_STATE_KEY, {
    name: "Battlefleet Gothic turn state",
    hint: "Internal persistent state used by the BFG Helper Turn Manager.",
    scope: "world",
    config: false,
    type: Object,
    default: defaultState(),
    onChange: state => {
      Hooks.callAll("bfgHelperTurnStateChanged", foundry.utils.deepClone(state));
    }
  });
}

export function getTurnState() {
  const stored = game.settings.get(MODULE_ID, TURN_STATE_KEY);
  return foundry.utils.mergeObject(defaultState(), stored ?? {}, {
    inplace: false,
    insertKeys: true,
    overwrite: true,
    recursive: true
  });
}

export async function setTurnState(state) {
  return game.settings.set(MODULE_ID, TURN_STATE_KEY, state);
}

export function getCurrentPhase() {
  return getTurnState().phase;
}

export function isPhase(phaseId) {
  return getCurrentPhase() === phaseId;
}

export function getActiveFleet() {
  const state = getTurnState();
  return state.fleets[getActingFleetIndex(state)] ?? null;
}

export function getActingFleetIndex(state = getTurnState()) {
  if (state.phase === "ordnance" && Number.isInteger(state.ordnanceFleetIndex)) {
    return state.ordnanceFleetIndex;
  }
  return state.activeFleetIndex;
}

function requireGM() {
  if (game.user?.isGM) return true;
  ui.notifications.warn("Only a Gamemaster can change the BFG turn state.");
  return false;
}

function normaliseFleetName(value, fallback) {
  const name = String(value ?? "").trim();
  return name || fallback;
}

export async function startBattle({ fleetA, fleetB, fleetAUserId = null, fleetBUserId = null, startingFleetIndex = 0 } = {}) {
  if (!requireGM()) return false;

  const { getShipsMissingLeadership } = await import("./leadership.js");
  const missingLeadership = getShipsMissingLeadership();
  if (missingLeadership.length) {
    ui.notifications.warn(`Assign starting Leadership before beginning the battle: ${missingLeadership.map(token => token.name).join(", ")}.`);
    return false;
  }

  const state = defaultState();
  state.battleStarted = true;
  state.battleId = foundry.utils.randomID();
  state.round = 1;
  state.fleets = [
    { id: "fleet-a", name: normaliseFleetName(fleetA, "Fleet A"), ownerUserId: fleetAUserId || null },
    { id: "fleet-b", name: normaliseFleetName(fleetB, "Fleet B"), ownerUserId: fleetBUserId || null }
  ];
  state.activeFleetIndex = Number(startingFleetIndex) === 1 ? 1 : 0;
  state.phase = "movement";

  await setTurnState(state);
  const { syncAllFleetTokenOwnership } = await import("./fleet-control.js");
  await syncAllFleetTokenOwnership(state);
  const lockedCount = await setBattleShipRotationLocks(true);
  await initialiseBattleCombatStates();
  ui.notifications.info(
    `Battle started: ${state.fleets[state.activeFleetIndex].name}, Movement phase. ${lockedCount} ship rotation lock${lockedCount === 1 ? "" : "s"} applied.`
  );
  return true;
}

export async function endBattle() {
  if (!requireGM()) return false;
  const { restoreAllFleetTokenOwnership } = await import("./fleet-control.js");
  await restoreAllFleetTokenOwnership();
  await setBattleShipRotationLocks(false);
  const state = getTurnState();
  state.battleStarted = false;
  await setTurnState(state);
  ui.notifications.info("Battle ended. Turn state has been retained for reference.");
  return true;
}

export async function resetBattle() {
  if (!requireGM()) return false;
  const { restoreAllFleetTokenOwnership } = await import("./fleet-control.js");
  await restoreAllFleetTokenOwnership();
  await setBattleShipRotationLocks(false);
  await resetAllCombatStates();
  const { resetOrdnance } = await import("./ordnance.js");
  await resetOrdnance();
  const { resetBoardingState } = await import("./boarding.js");
  await resetBoardingState();
  const { resetEndPhaseState } = await import("./end-phase.js");
  await resetEndPhaseState();
  const { resetSpecialOrders } = await import("./special-orders.js");
  await resetSpecialOrders();
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.document.getFlag(MODULE_ID, "firedWeapons") !== undefined) {
      await token.document.unsetFlag(MODULE_ID, "firedWeapons");
    }
    if (token.document.getFlag(MODULE_ID, "movementState") !== undefined) {
      await token.document.unsetFlag(MODULE_ID, "movementState");
    }
    if (token.document.getFlag(MODULE_ID, "pendingHitAndRun") !== undefined) {
      await token.document.unsetFlag(MODULE_ID, "pendingHitAndRun");
    }
  }
  await setTurnState(defaultState());
  ui.notifications.info("Battlefleet Gothic turn state reset.");
  return true;
}

export async function nextPhase() {
  if (!requireGM()) return false;

  const state = getTurnState();
  if (!state.battleStarted) {
    ui.notifications.warn("Start a battle before advancing phases.");
    return false;
  }

  if (state.phase === "end") {
    const { unresolvedRepairableDamageShips, blastMarkerRemovalResolved } = await import("./end-phase.js");
    const unresolved = unresolvedRepairableDamageShips(state);
    if (unresolved.length) {
      ui.notifications.warn(`Resolve Damage Control for ships with repairable critical damage before leaving the End Phase: ${unresolved.map(token => token.name).join(", ")}.`);
      return false;
    }
    if (!blastMarkerRemovalResolved(state)) {
      ui.notifications.warn("Complete and confirm the Remove Blast Markers step before leaving the End Phase.");
      return false;
    }
    const { clearFleetOrders } = await import("./special-orders.js");
    await clearFleetOrders(state.fleets?.[state.activeFleetIndex]?.id, state, {
      clearNormalOrders: false,
      clearExpiringBrace: true
    });
  }

  if (state.phase === "ordnance") {
    if (state.ordnanceFleetIndex === state.activeFleetIndex) {
      state.ordnanceFleetIndex = state.fleets.findIndex(
        (_fleet, index) => index !== state.activeFleetIndex
      );
      if (state.ordnanceFleetIndex < 0) state.ordnanceFleetIndex = state.activeFleetIndex;
    } else {
      state.phase = "end";
      state.ordnanceFleetIndex = null;
    }
    await setTurnState(state);
    const fleet = state.fleets[getActingFleetIndex(state)]?.name ?? "Unknown fleet";
    const phase = PHASES.find(item => item.id === state.phase)?.label ?? state.phase;
    ui.notifications.info(`Round ${state.round}: ${fleet} - ${phase}.`);
    return true;
  }

  const currentIndex = PHASES.findIndex(phase => phase.id === state.phase);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  if (safeIndex < PHASES.length - 1) {
    state.phase = PHASES[safeIndex + 1].id;
    if (state.phase === "ordnance") state.ordnanceFleetIndex = state.activeFleetIndex;
  } else {
    const isLastFleet = state.activeFleetIndex >= state.fleets.length - 1;
    state.activeFleetIndex = isLastFleet ? 0 : state.activeFleetIndex + 1;
    if (isLastFleet) state.round += 1;
    state.phase = PHASES[0].id;
  }

  if (state.phase === "movement") {
    const { clearFleetOrders } = await import("./special-orders.js");
    await clearFleetOrders(state.fleets?.[state.activeFleetIndex]?.id, state, {
      clearNormalOrders: true,
      clearExpiringBrace: false
    });
  }

  await setTurnState(state);
  const fleet = state.fleets[getActingFleetIndex(state)]?.name ?? "Unknown fleet";
  const phase = PHASES.find(item => item.id === state.phase)?.label ?? state.phase;
  ui.notifications.info(`Round ${state.round}: ${fleet} - ${phase}.`);
  return true;
}

export async function previousPhase() {
  if (!requireGM()) return false;

  const state = getTurnState();
  if (!state.battleStarted) {
    ui.notifications.warn("Start a battle before changing phases.");
    return false;
  }

  if (state.phase === "end") {
    state.phase = "ordnance";
    state.ordnanceFleetIndex = state.fleets.findIndex(
      (_fleet, index) => index !== state.activeFleetIndex
    );
    if (state.ordnanceFleetIndex < 0) state.ordnanceFleetIndex = state.activeFleetIndex;
    await setTurnState(state);
    return true;
  }
  if (state.phase === "ordnance" && state.ordnanceFleetIndex !== state.activeFleetIndex) {
    state.ordnanceFleetIndex = state.activeFleetIndex;
    await setTurnState(state);
    return true;
  }

  const currentIndex = PHASES.findIndex(phase => phase.id === state.phase);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;

  if (safeIndex > 0) {
    state.phase = PHASES[safeIndex - 1].id;
    state.ordnanceFleetIndex = null;
  } else if (state.activeFleetIndex > 0) {
    state.activeFleetIndex -= 1;
    state.phase = PHASES.at(-1).id;
  } else if (state.round > 1) {
    state.round -= 1;
    state.activeFleetIndex = state.fleets.length - 1;
    state.phase = PHASES.at(-1).id;
  } else {
    ui.notifications.info("Already at the beginning of Round 1.");
    return false;
  }

  await setTurnState(state);
  return true;
}


export async function openBattleSetup() {
  if (!requireGM()) return false;

  const state = getTurnState();
  const playerOptions = (selectedId) => {
    const unassigned = `<option value="" ${selectedId ? "" : "selected"}>Unassigned</option>`;
    return unassigned + (game.users ?? [])
      .map(user => `<option value="${user.id}" ${user.id === selectedId ? "selected" : ""}>${foundry.utils.escapeHTML(user.name)}${user.isGM ? " (Gamemaster)" : ""}${user.active ? "" : " (offline)"}</option>`)
      .join("");
  };
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: "Battlefleet Gothic: Battle Setup" },
    content: `
      <div class="bfg-dialog bfg-turn-manager">
        <p>Set the two participating fleets and choose which fleet takes the first turn.</p>

        <label>Fleet A</label>
        <input
          type="text"
          name="fleetA"
          value="${foundry.utils.escapeHTML(state.fleets[0]?.name ?? "Fleet A")}"
        >

        <label>Fleet A player</label>
        <select name="fleetAUserId">${playerOptions(state.fleets[0]?.ownerUserId)}</select>

        <label>Fleet B</label>
        <input
          type="text"
          name="fleetB"
          value="${foundry.utils.escapeHTML(state.fleets[1]?.name ?? "Fleet B")}"
        >


        <label>Fleet B player</label>
        <select name="fleetBUserId">${playerOptions(state.fleets[1]?.ownerUserId)}</select>

        <label>Starting fleet</label>
        <select name="startingFleetIndex">
          <option value="0" ${state.activeFleetIndex === 0 ? "selected" : ""}>Fleet A</option>
          <option value="1" ${state.activeFleetIndex === 1 ? "selected" : ""}>Fleet B</option>
        </select>
      </div>`,
    ok: {
      label: "Start Battle",
      icon: "fa-solid fa-flag"
    },
    rejectClose: false,
    modal: true
  });

  if (!result) return false;

  return startBattle({
    fleetA: result.fleetA,
    fleetB: result.fleetB,
    fleetAUserId: result.fleetAUserId || null,
    fleetBUserId: result.fleetBUserId || null,
    startingFleetIndex: Number(result.startingFleetIndex)
  });
}

export async function openTurnManager() {
  const { openTurnManagerApplication } = await import("./turn-manager-app.js");
  return openTurnManagerApplication();
}

export const turnManager = {
  PHASES,
  getState: getTurnState,
  getPhase: getCurrentPhase,
  getActiveFleet,
  isPhase,
  open: openTurnManager,
  setup: openBattleSetup,
  start: startBattle,
  next: nextPhase,
  previous: previousPhase,
  end: endBattle,
  reset: resetBattle
};
