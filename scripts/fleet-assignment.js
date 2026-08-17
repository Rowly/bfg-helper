import { getShipData, getBaseActor } from "./ship-data.js";
import { MODULE_ID, FLAG_KEY } from "./constants.js";
import { getTurnState } from "./turn-manager.js";
import { syncTokenRotationLock } from "./rotation-locking.js";
import { getCombatState, initialiseCombatState } from "./combat-state.js";
import { getLeadership, getEffectiveLeadership } from "./leadership.js";

function selectedShip() {
  const controlled = canvas.tokens.controlled;
  if (controlled.length !== 1) {
    ui.notifications.warn("Please select exactly one configured ship token.");
    return null;
  }

  const token = controlled[0];
  if (!token.actor) {
    ui.notifications.error("The selected token has no associated Actor.");
    return null;
  }

  return token;
}

/**
 * Fleet membership belongs to the deployed ship, not to its reusable Actor
 * profile. Store and read it directly on the TokenDocument.
 */
export function getTokenFleetId(tokenOrDocument) {
  const document = tokenOrDocument?.document?.documentName === "Token"
    ? tokenOrDocument.document
    : tokenOrDocument?.documentName === "Token"
      ? tokenOrDocument
      : null;

  if (!document) return null;
  const fleetId = document.getFlag(MODULE_ID, "fleetId");
  return fleetId ? String(fleetId) : null;
}

export async function assignSelectedShipToFleet() {
  if (!game.user?.isGM) {
    ui.notifications.warn("Only a Gamemaster can assign ships to fleets.");
    return false;
  }

  const token = selectedShip();
  if (!token) return false;

  const actor = getBaseActor(token);
  const shipData = getShipData(actor);
  if (!shipData) {
    ui.notifications.warn(
      `${actor?.name ?? token.name} has not been configured as a BFG ship yet.`
    );
    return false;
  }

  const state = getTurnState();
  const fleets = state.fleets ?? [];
  if (fleets.length === 0) {
    ui.notifications.warn("Configure the Turn Manager fleets first.");
    return false;
  }

  const currentFleetId = getTokenFleetId(token);
  const options = fleets.map((fleet, index) => {
    const selected = currentFleetId === fleet.id ? "selected" : "";
    return `<option value="${fleet.id}" ${selected}>${foundry.utils.escapeHTML(fleet.name || `Fleet ${index + 1}`)}</option>`;
  }).join("");

  const shipName = token.name || actor?.name || "Ship";

  const result = await foundry.applications.api.DialogV2.input({
    window: { title: `Assign Fleet: ${shipName}` },
    content: `
      <div class="bfg-dialog">
        <p>Assign <strong>${foundry.utils.escapeHTML(shipName)}</strong> to one of the fleets configured in the Turn Manager.</p>
        <label>Fleet</label>
        <select name="fleetId">${options}</select>
      </div>`,
    ok: {
      label: "Assign Fleet",
      icon: "fa-solid fa-flag"
    },
    rejectClose: false,
    modal: true
  });

  if (!result) return false;

  const fleet = fleets.find(item => item.id === String(result.fleetId));
  if (!fleet) {
    ui.notifications.error("The selected fleet could not be found.");
    return false;
  }

  await token.document.setFlag(MODULE_ID, "fleetId", fleet.id);
  await token.document.setFlag(MODULE_ID, "fleetName", fleet.name);
  await initialiseCombatState(token);
  await syncTokenRotationLock(token, state.battleStarted);
  const { syncFleetTokenOwnership } = await import("./fleet-control.js");
  await syncFleetTokenOwnership(token, state);

  ui.notifications.info(`${shipName} assigned to ${fleet.name}.`);
  Hooks.callAll("bfgHelperFleetAssignmentsChanged", token.document);
  return true;
}

export async function clearSelectedShipFleet() {
  if (!game.user?.isGM) {
    ui.notifications.warn("Only a Gamemaster can change fleet assignments.");
    return false;
  }

  const token = selectedShip();
  if (!token) return false;

  const actor = getBaseActor(token);
  const shipData = getShipData(actor);
  if (!shipData) {
    ui.notifications.warn(
      `${actor?.name ?? token.name} has not been configured as a BFG ship yet.`
    );
    return false;
  }

  await token.document.unsetFlag(MODULE_ID, "fleetId");
  await token.document.unsetFlag(MODULE_ID, "fleetName");
  const { restoreFleetTokenOwnership } = await import("./fleet-control.js");
  await restoreFleetTokenOwnership(token);
  await syncTokenRotationLock(token, false);

  ui.notifications.info(`${token.name} is no longer assigned to a fleet.`);
  Hooks.callAll("bfgHelperFleetAssignmentsChanged", token.document);
  return true;
}

/**
 * Return every deployed token on the current canvas which belongs to a fleet.
 * Each TokenDocument is an individual ship, even when multiple tokens share
 * the same Actor/profile.
 */
export function getFleetShips(fleetId) {
  if (!fleetId || !canvas?.ready) return [];

  const wantedFleetId = String(fleetId);

  return (canvas.tokens?.placeables ?? [])
    .filter(token => getTokenFleetId(token) === wantedFleetId)
    .map(token => {
      const actor = getBaseActor(token);
      const data = getShipData(actor);
      const combatState = getCombatState(token);
      const leadership = getLeadership(token);
      const boarding = token.document.getFlag(MODULE_ID, "boardingAction");
      const pendingHitAndRun = Math.max(0, Math.trunc(Number(token.document.getFlag(MODULE_ID, "pendingHitAndRun")?.count) || 0));
      const pendingActions = [];
      const specialOrder = token.document.getFlag(MODULE_ID, "specialOrder");
      if (boarding?.partnerId) {
        pendingActions.push(boarding.drawn
          ? "Boarding action ongoing"
          : boarding.initiatorId === token.document.id
            ? "Boarding declared"
            : "Boarding target");
      }
      if (pendingHitAndRun > 0) pendingActions.push(`Pending Hit-and-Run x${pendingHitAndRun}`);
      if (specialOrder?.name) pendingActions.push(`Special Order: ${specialOrder.name}`);
      const effectiveLeadership = leadership ? getEffectiveLeadership(token) : null;
      return {
        tokenId: token.document.id,
        actorId: actor?.id ?? null,
        actorName: token.name || actor?.name || "Unnamed ship",
        shipClass: data?.shipClass ?? actor?.name ?? "Unconfigured ship",
        faction: data?.faction ?? "",
        combatState,
        leadership,
        effectiveLeadership,
        leadershipAdjusted: Boolean(leadership && effectiveLeadership !== leadership.value),
        hasLeadership: Boolean(leadership),
        pendingActions,
        hasCombatState: Boolean(combatState),
        combatStatus: combatState?.catastrophicState?.name
          ?? (combatState?.outOfAction
          ? "Out of action"
          : combatState?.crippled
            ? "Crippled"
            : "Operational")
      };
    })
    .sort((a, b) => a.actorName.localeCompare(b.actorName));
}

/**
 * One-time compatibility migration for 0.5.0-0.5.3 worlds.
 *
 * Older builds stored fleet membership on the Actor. Copy that assignment to
 * every currently deployed token which uses the Actor, then remove the Actor
 * assignment so newly deployed ships are not automatically enrolled later.
 */
export async function migrateActorFleetAssignmentsToTokens() {
  if (!game.user?.isGM || !canvas?.ready) return;

  const actorsToClear = new Map();
  let migratedCount = 0;

  for (const token of canvas.tokens?.placeables ?? []) {
    if (getTokenFleetId(token)) continue;

    const actor = getBaseActor(token);
    if (!actor) continue;

    const shipData = getShipData(actor);
    const legacyFleetId = actor.getFlag(MODULE_ID, "fleetId")
      ?? shipData?.fleetId;

    if (!legacyFleetId) continue;

    const legacyFleetName = actor.getFlag(MODULE_ID, "fleetName")
      ?? shipData?.fleetName
      ?? "";

    await token.document.setFlag(MODULE_ID, "fleetId", String(legacyFleetId));
    if (legacyFleetName) {
      await token.document.setFlag(MODULE_ID, "fleetName", String(legacyFleetName));
    }

    actorsToClear.set(actor.id, actor);
    migratedCount += 1;
  }

  // Remove the old Actor-level fields after all current tokens have inherited
  // them. Fleet membership from this point onward is token-only.
  for (const actor of actorsToClear.values()) {
    await actor.unsetFlag(MODULE_ID, "fleetId");
    await actor.unsetFlag(MODULE_ID, "fleetName");

    const shipData = actor.getFlag(MODULE_ID, FLAG_KEY);
    if (shipData?.fleetId || shipData?.fleetName) {
      await actor.update({
        [`flags.${MODULE_ID}.${FLAG_KEY}.-=fleetId`]: null,
        [`flags.${MODULE_ID}.${FLAG_KEY}.-=fleetName`]: null
      });
    }
  }

  if (migratedCount > 0) {
    console.log(`BFG Helper | Migrated ${migratedCount} fleet assignment(s) from Actors to deployed tokens.`);
    Hooks.callAll("bfgHelperFleetAssignmentsChanged");
  }
}

// Compatibility alias for code/macros from 0.5.3.
export const migrateSyntheticFleetAssignments = migrateActorFleetAssignmentsToTokens;
