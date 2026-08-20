import { MODULE_ID } from "./constants.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getShipData } from "./ship-data.js";

export const SQUADRON_REGISTRY_KEY = "squadronRegistry";
const SQUADRON_FLAG = "squadronId";

function normaliseRegistry(value) {
  const squadrons = Array.isArray(value?.squadrons) ? value.squadrons : [];
  return {
    squadrons: squadrons
      .filter(item => item?.id && item?.fleetId)
      .map(item => ({
        id: String(item.id),
        name: String(item.name || "Unnamed Squadron"),
        fleetId: String(item.fleetId),
        type: item.type === "escort" ? "escort" : "capital"
      }))
  };
}

export function registerSquadronSettings() {
  game.settings.register(MODULE_ID, SQUADRON_REGISTRY_KEY, {
    name: "Battlefleet Gothic squadron registry",
    hint: "Internal persistent definitions for squadrons created from deployed ships.",
    scope: "world",
    config: false,
    type: Object,
    default: { squadrons: [] },
    onChange: value => Hooks.callAll("bfgHelperSquadronsChanged", normaliseRegistry(value))
  });
}

export function getSquadronRegistry() {
  return normaliseRegistry(game.settings.get(MODULE_ID, SQUADRON_REGISTRY_KEY));
}

async function setSquadronRegistry(registry) {
  return game.settings.set(MODULE_ID, SQUADRON_REGISTRY_KEY, normaliseRegistry(registry));
}

export function getTokenSquadronId(tokenOrDocument) {
  const document = tokenOrDocument?.document?.documentName === "Token"
    ? tokenOrDocument.document
    : tokenOrDocument?.documentName === "Token"
      ? tokenOrDocument
      : null;
  const id = document?.getFlag(MODULE_ID, SQUADRON_FLAG);
  return id ? String(id) : null;
}

export function getSquadron(squadronId) {
  return getSquadronRegistry().squadrons.find(item => item.id === String(squadronId ?? "")) ?? null;
}

export function getSquadronMembers(squadronId) {
  if (!squadronId || !canvas?.ready) return [];
  const wanted = String(squadronId);
  return (canvas.tokens?.placeables ?? []).filter(token => getTokenSquadronId(token) === wanted);
}

function selectedConfiguredShips() {
  const selected = canvas.tokens?.controlled ?? [];
  if (!selected.length) {
    ui.notifications.warn("Select one or more configured ships.");
    return null;
  }
  const invalid = selected.filter(token => !getShipData(token));
  if (invalid.length) {
    ui.notifications.warn(`The selection contains unconfigured tokens: ${invalid.map(token => token.name).join(", ")}.`);
    return null;
  }
  return selected;
}

function selectionDetails(tokens) {
  const fleetIds = new Set(tokens.map(getTokenFleetId).filter(Boolean));
  if (fleetIds.size !== 1 || tokens.some(token => !getTokenFleetId(token))) {
    return { error: "Every selected ship must belong to the same fleet." };
  }
  const types = new Set(tokens.map(token => getShipData(token)?.stats?.targetClass));
  if (types.size !== 1 || !["escort", "capital"].includes([...types][0])) {
    return { error: "A squadron may contain only escorts or only capital ships." };
  }
  const type = [...types][0];
  if (type === "escort" && tokens.length > 6) {
    return { error: "An escort squadron may contain no more than six ships." };
  }
  return { fleetId: [...fleetIds][0], type };
}

async function setMembership(tokens, squadronId) {
  for (const token of tokens) {
    if (squadronId) await token.document.setFlag(MODULE_ID, SQUADRON_FLAG, squadronId);
    else await token.document.unsetFlag(MODULE_ID, SQUADRON_FLAG);
  }
  Hooks.callAll("bfgHelperSquadronsChanged", getSquadronRegistry());
}

export async function clearTokenSquadronMembership(tokenOrDocument) {
  const document = tokenOrDocument?.document?.documentName === "Token"
    ? tokenOrDocument.document
    : tokenOrDocument?.documentName === "Token"
      ? tokenOrDocument
      : null;
  if (!document || !getTokenSquadronId(document)) return false;
  await document.unsetFlag(MODULE_ID, SQUADRON_FLAG);
  Hooks.callAll("bfgHelperSquadronsChanged", getSquadronRegistry());
  return true;
}

function requireGM() {
  if (game.user?.isGM) return true;
  ui.notifications.warn("Only a Gamemaster can manage squadrons.");
  return false;
}

export async function createSquadronFromSelectedShips() {
  if (!requireGM()) return false;
  const tokens = selectedConfiguredShips();
  if (!tokens) return false;
  const details = selectionDetails(tokens);
  if (details.error) {
    ui.notifications.warn(details.error);
    return false;
  }

  const state = (await import("./turn-manager.js")).getTurnState();
  const fleet = state.fleets?.find(item => item.id === details.fleetId);
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: "Create Squadron" },
    content: `<div class="bfg-dialog"><p>Create a ${details.type} squadron in <strong>${foundry.utils.escapeHTML(fleet?.name ?? details.fleetId)}</strong> from ${tokens.length} selected ship${tokens.length === 1 ? "" : "s"}.</p><label>Squadron name</label><input type="text" name="name" value="${details.type === "escort" ? "Escort Squadron" : "Capital Ship Squadron"}"></div>`,
    ok: { label: "Create Squadron", icon: "fa-solid fa-object-group" },
    rejectClose: false,
    modal: true
  });
  if (!result) return false;
  const name = String(result.name ?? "").trim();
  if (!name) {
    ui.notifications.warn("Enter a squadron name.");
    return false;
  }

  const registry = getSquadronRegistry();
  const squadron = { id: foundry.utils.randomID(), name, fleetId: details.fleetId, type: details.type };
  registry.squadrons.push(squadron);
  await setSquadronRegistry(registry);
  await setMembership(tokens, squadron.id);
  ui.notifications.info(`${name} created with ${tokens.length} ship${tokens.length === 1 ? "" : "s"}.`);
  return true;
}

export async function assignSelectedShipsToSquadron() {
  if (!requireGM()) return false;
  const tokens = selectedConfiguredShips();
  if (!tokens) return false;
  const details = selectionDetails(tokens);
  if (details.error) {
    ui.notifications.warn(details.error);
    return false;
  }
  const candidates = getSquadronRegistry().squadrons.filter(item => item.fleetId === details.fleetId && item.type === details.type);
  if (!candidates.length) {
    ui.notifications.warn("Create a compatible squadron for this fleet first.");
    return false;
  }
  const options = candidates.map(item => `<option value="${item.id}">${foundry.utils.escapeHTML(item.name)}</option>`).join("");
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: "Assign Ships to Squadron" },
    content: `<div class="bfg-dialog"><p>Assign ${tokens.length} selected ship${tokens.length === 1 ? "" : "s"} to a squadron.</p><label>Squadron</label><select name="squadronId">${options}</select></div>`,
    ok: { label: "Assign", icon: "fa-solid fa-link" },
    rejectClose: false,
    modal: true
  });
  if (!result) return false;
  const squadron = candidates.find(item => item.id === String(result.squadronId));
  if (!squadron) return false;
  const existing = getSquadronMembers(squadron.id).filter(token => !tokens.includes(token));
  if (squadron.type === "escort" && existing.length + tokens.length > 6) {
    ui.notifications.warn("This assignment would exceed the six-ship escort squadron limit.");
    return false;
  }
  await setMembership(tokens, squadron.id);
  ui.notifications.info(`${tokens.length} ship${tokens.length === 1 ? "" : "s"} assigned to ${squadron.name}.`);
  return true;
}

export async function removeSelectedShipsFromSquadrons() {
  if (!requireGM()) return false;
  const tokens = selectedConfiguredShips();
  if (!tokens) return false;
  const assigned = tokens.filter(getTokenSquadronId);
  if (!assigned.length) {
    ui.notifications.info("None of the selected ships belongs to a squadron.");
    return false;
  }
  await setMembership(assigned, null);
  ui.notifications.info(`${assigned.length} ship${assigned.length === 1 ? "" : "s"} removed from squadron membership.`);
  return true;
}

export async function disbandSquadron() {
  if (!requireGM()) return false;
  const registry = getSquadronRegistry();
  if (!registry.squadrons.length) {
    ui.notifications.info("There are no squadrons to disband.");
    return false;
  }
  const state = (await import("./turn-manager.js")).getTurnState();
  const options = registry.squadrons.map(item => {
    const fleet = state.fleets?.find(entry => entry.id === item.fleetId);
    return `<option value="${item.id}">${foundry.utils.escapeHTML(item.name)} (${foundry.utils.escapeHTML(fleet?.name ?? item.fleetId)})</option>`;
  }).join("");
  const result = await foundry.applications.api.DialogV2.input({
    window: { title: "Disband Squadron" },
    content: `<div class="bfg-dialog"><p>Disbanding removes squadron membership from its deployed ships.</p><label>Squadron</label><select name="squadronId">${options}</select></div>`,
    ok: { label: "Disband", icon: "fa-solid fa-object-ungroup" },
    rejectClose: false,
    modal: true
  });
  if (!result) return false;
  const squadron = registry.squadrons.find(item => item.id === String(result.squadronId));
  if (!squadron) return false;
  await setMembership(getSquadronMembers(squadron.id), null);
  registry.squadrons = registry.squadrons.filter(item => item.id !== squadron.id);
  await setSquadronRegistry(registry);
  ui.notifications.info(`${squadron.name} disbanded.`);
  return true;
}

export function getSquadronCards() {
  const registry = getSquadronRegistry();
  return registry.squadrons.map(squadron => {
    const members = getSquadronMembers(squadron.id).map(token => ({
      tokenId: token.id,
      name: token.name,
      shipClass: getShipData(token)?.shipClass ?? "Unconfigured ship"
    })).sort((a, b) => a.name.localeCompare(b.name));
    return { ...squadron, typeLabel: squadron.type === "escort" ? "Escort" : "Capital ship", members, memberCount: members.length, hasMembers: members.length > 0 };
  });
}
