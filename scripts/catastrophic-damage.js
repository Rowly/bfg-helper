import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { diceFaces, publishBFGDice } from "./dice.js";

export const CATASTROPHIC_DAMAGE_FLAG = "catastrophicDamage";

function asTokenDocument(tokenOrDocument) {
  if (tokenOrDocument?.document?.documentName === "Token") return tokenOrDocument.document;
  return tokenOrDocument?.documentName === "Token" ? tokenOrDocument : null;
}

async function rollValues(formula, flavor, document) {
  const roll = await new Roll(formula).evaluate();
  await publishBFGDice(roll, {
    speaker: ChatMessage.getSpeaker({ token: document }),
    flavor
  });
  return {
    total: Number(roll.total ?? 0),
    values: diceFaces(roll)
  };
}

export function getCatastrophicState(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  return document?.getFlag(MODULE_ID, CATASTROPHIC_DAMAGE_FLAG) ?? null;
}

export function isHulk(state) {
  return ["drifting-hulk", "blazing-hulk"].includes(state?.type);
}

export async function rollCatastrophicDamage(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  const shipData = getShipData(document);
  if (!document || !shipData) throw new Error("A configured deployed ship is required.");

  const startingHits = Math.max(1, Math.trunc(Number(shipData.stats?.hits)));
  const targetClass = String(shipData.stats?.targetClass ?? "capital").toLowerCase();
  if (targetClass === "escort") {
    return {
      type: "escort-debris",
      name: "Escort Destroyed",
      tableDice: [],
      tableTotal: null,
      blastMarkers: 1,
      instruction: "Replace the escort with 1 centrally placed Blast Marker."
    };
  }

  const table = await rollValues("2d6", `${document.name}: Catastrophic Damage table`, document);
  if (table.total <= 6) {
    return {
      type: "drifting-hulk",
      name: "Drifting Hulk",
      tableDice: table.values,
      tableTotal: table.total,
      blastMarkers: 1,
      futureMovement: "4d6 cm forward in each subsequent Movement phase",
      instruction: "Place 1 Blast Marker in contact with the hulk after each move."
    };
  }
  if (table.total <= 8) {
    return {
      type: "blazing-hulk",
      name: "Blazing Hulk",
      tableDice: table.values,
      tableTotal: table.total,
      blastMarkers: 1,
      futureMovement: "4d6 cm forward in each subsequent Movement phase",
      instruction: "Place 1 Blast Marker after each move, then roll again on the Catastrophic Damage table."
    };
  }

  const range = await rollValues("3d6", `${document.name}: Catastrophic explosion range`, document);
  const warp = table.total === 12;
  const blastMarkers = warp ? startingHits : Math.ceil(startingHits / 2);
  const explosionStrength = warp ? startingHits : Math.ceil(startingHits / 2);
  return {
    type: warp ? "warp-drive-implosion" : "plasma-drive-overload",
    name: warp ? "Warp Drive Implosion" : "Plasma Drive Overload",
    tableDice: table.values,
    tableTotal: table.total,
    blastMarkers,
    explosionRangeCm: range.total,
    explosionRangeDice: range.values,
    explosionStrength,
    instruction: `Remove the ship from play. Every ship within ${range.total} cm is struck by a Strength ${explosionStrength} lance attack; shields work normally.`
  };
}

export async function setCatastrophicState(tokenOrDocument, state) {
  const document = asTokenDocument(tokenOrDocument);
  if (!document) throw new Error("A deployed ship token is required.");
  await document.setFlag(MODULE_ID, CATASTROPHIC_DAMAGE_FLAG, state);
  Hooks.callAll("bfgHelperCatastrophicStateChanged", document, state);
  return state;
}

export async function clearCatastrophicState(tokenOrDocument) {
  const document = asTokenDocument(tokenOrDocument);
  if (!document) return false;
  await document.unsetFlag(MODULE_ID, CATASTROPHIC_DAMAGE_FLAG);
  Hooks.callAll("bfgHelperCatastrophicStateChanged", document, null);
  return true;
}
