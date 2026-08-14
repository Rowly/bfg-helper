import { MODULE_ID } from "./constants.js";
import { getActingFleetIndex, getTurnState } from "./turn-manager.js";

const DEFENSE_FLAG = "ordnanceDefense";

function defenseKey(state = getTurnState()) {
  return `${state.battleId ?? "no-battle"}:${state.round}:${state.activeFleetIndex}:${getActingFleetIndex(state)}`;
}

export function getTurretDefenseChoice(tokenOrDocument) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  const stored = document?.getFlag?.(MODULE_ID, DEFENSE_FLAG);
  if (stored?.activationKey !== defenseKey()) return null;
  return stored.choice ?? null;
}

export async function commitTurretDefenseChoice(tokenOrDocument, choice) {
  const document = tokenOrDocument?.document ?? tokenOrDocument;
  const state = getTurnState();
  if (state.phase !== "ordnance") return true;
  const existing = getTurretDefenseChoice(document);
  if (existing && existing !== choice) {
    ui.notifications.warn(`${document.name}'s turrets are already committed against ${existing === "torpedo" ? "torpedoes" : "attack craft"} this Ordnance phase.`);
    return false;
  }
  if (!existing) {
    await document.setFlag(MODULE_ID, DEFENSE_FLAG, {
      activationKey: defenseKey(state),
      choice
    });
  }
  return true;
}
