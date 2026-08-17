import { MODULE_ID } from "./constants.js";
import { getShipData } from "./ship-data.js";
import { getCombatState, halveRoundedUp, setCombatState } from "./combat-state.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getActingFleetIndex, getTurnState } from "./turn-manager.js";
import { getCriticalState, isWeaponDisabledByCritical, rollCriticalHits, setCriticalState } from "./critical-hits.js";
import { getCatastrophicState, rollCatastrophicDamage, setCatastrophicState } from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { commitTurretDefenseChoice, getTurretDefenseChoice } from "./ordnance-defense.js";
import { getBoardingState, hasDeclaredBoarding } from "./boarding.js";
import { openActionResolution } from "./action-resolution-app.js";
import { braceReactionControls, effectiveOrdnanceStrength, readBraceReactionOptions, resolveBraceReaction, rollBraceSaves } from "./special-orders.js";
import { playTorpedoReplayAnimation } from "./shooting-effects.js";
import {
  ORDNANCE_MARKER_FLAG,
  ORDNANCE_STATE_FLAG,
  clearOrdnanceMovementPreview,
  drawOrdnanceTrail,
  getOrdnanceMarker,
  getOrdnanceState
} from "./ordnance.js";

const TORPEDO_IMAGE = "modules/bfg-helper/assets/torpedo-salvo-v3.svg";

export async function refreshTorpedoMarkerArtwork() {
  if (!game.user?.isGM) return false;
  const actor = game.actors?.find(item =>
    item.getFlag(MODULE_ID, "ordnanceActorType") === "torpedo-salvo"
  );
  if (actor) {
    await actor.update({
      img: TORPEDO_IMAGE,
      "prototypeToken.width": 2,
      "prototypeToken.height": 2,
      "prototypeToken.texture.src": TORPEDO_IMAGE,
      "prototypeToken.texture.fit": "contain",
      "prototypeToken.lockRotation": true
    });
  }
  for (const token of canvas.tokens?.placeables ?? []) {
    if (getOrdnanceMarker(token)?.category !== "torpedo") continue;
    await token.document.update({
      width: 2,
      height: 2,
      "texture.src": TORPEDO_IMAGE,
      "texture.fit": "contain",
      lockRotation: true
    });
  }
  return true;
}

function selectedToken() {
  const selected = canvas.tokens?.controlled ?? [];
  if (selected.length !== 1) {
    ui.notifications.warn("Please select exactly one ship or torpedo salvo.");
    return null;
  }
  return selected[0];
}

function actorType() {
  return game.system?.documentTypes?.Actor?.[0] ?? "base";
}

async function torpedoActor() {
  const existing = game.actors?.find(actor =>
    actor.getFlag(MODULE_ID, "ordnanceActorType") === "torpedo-salvo"
  );
  if (existing) {
    if (game.user?.isGM) await refreshTorpedoMarkerArtwork();
    return existing;
  }
  if (!game.user?.isGM) throw new Error("A Gamemaster must create the Torpedo Salvo marker Actor first.");
  return Actor.create({
    name: "Torpedo Salvo",
    type: actorType(),
    img: TORPEDO_IMAGE,
    prototypeToken: {
      name: "Torpedo Salvo",
      width: 2,
      height: 2,
      texture: { src: TORPEDO_IMAGE, fit: "contain" },
      disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
      lockRotation: true
    },
    flags: { [MODULE_ID]: { ordnanceActorType: "torpedo-salvo" } }
  }, { renderSheet: false });
}

function sceneScale() {
  const grid = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  if (!(grid > 0) || !(distance > 0)) throw new Error("The Scene requires a valid grid scale.");
  return { grid, pixelsPerCm: grid / distance };
}

function torpedoStart(ship, rotation) {
  const { grid } = sceneScale();
  const radians = rotation * Math.PI / 180;
  const forwardDistance = Math.max(Number(ship.w), Number(ship.h)) / 2 + grid / 2;
  return {
    x: ship.center.x + Math.sin(radians) * forwardDistance,
    y: ship.center.y - Math.cos(radians) * forwardDistance
  };
}

function torpedoDestination(ship, rotation, speedCm) {
  const { pixelsPerCm } = sceneScale();
  const start = torpedoStart(ship, rotation);
  const radians = rotation * Math.PI / 180;
  return {
    x: start.x + Math.sin(radians) * speedCm * pixelsPerCm,
    y: start.y - Math.cos(radians) * speedCm * pixelsPerCm
  };
}

function drawTorpedoLaunchPreview(ship, rotation, speedCm) {
  clearOrdnanceMovementPreview();
  const { grid, pixelsPerCm } = sceneScale();
  const radians = rotation * Math.PI / 180;
  const start = torpedoStart(ship, rotation);
  const destination = {
    x: start.x + Math.sin(radians) * speedCm * pixelsPerCm,
    y: start.y - Math.cos(radians) * speedCm * pixelsPerCm
  };
  const halfWidth = grid;
  const offsetX = -Math.cos(radians) * halfWidth;
  const offsetY = -Math.sin(radians) * halfWidth;
  const graphics = new PIXI.Graphics();
  graphics.name = `bfg-torpedo-launch-preview-${ship.document.id}`;
  graphics.beginFill(0xffcc66, 0.16);
  graphics.drawPolygon([
    start.x + offsetX, start.y + offsetY,
    destination.x + offsetX, destination.y + offsetY,
    destination.x - offsetX, destination.y - offsetY,
    start.x - offsetX, start.y - offsetY
  ]);
  graphics.endFill();
  graphics.lineStyle(Math.max(4, grid * 0.06), 0xffcc66, 0.95);
  graphics.moveTo(start.x, start.y);
  graphics.lineTo(destination.x, destination.y);
  const arrowSize = Math.max(12, grid * 0.22);
  const angle = (rotation - 90) * Math.PI / 180;
  for (const offset of [150, -150]) {
    const arrowAngle = angle + offset * Math.PI / 180;
    graphics.moveTo(destination.x, destination.y);
    graphics.lineTo(destination.x + Math.cos(arrowAngle) * arrowSize, destination.y + Math.sin(arrowAngle) * arrowSize);
  }
  graphics.beginFill(0xffcc66, 0.14);
  graphics.drawCircle(start.x, start.y, grid / 2);
  graphics.endFill();
  canvas.tokens.addChild(graphics);
  globalThis.bfgOrdnanceMovementPreview = graphics;
  return start;
}

function torpedoLauncher(shipData) {
  return (shipData?.ordnance ?? []).find(item => String(item.type).toLowerCase() === "torpedo") ?? null;
}

function launchErrors(ship, fleetId, launcher) {
  const state = getTurnState();
  const errors = [];
  if (!state.battleStarted) errors.push("No battle is in progress.");
  if (state.phase !== "shooting") errors.push("Torpedoes are launched at the end of the Shooting phase.");
  if (!fleetId) errors.push(`${ship.name} is not assigned to a fleet.`);
  if (fleetId && state.fleets?.[state.activeFleetIndex]?.id !== fleetId) errors.push(`${ship.name} does not belong to the active fleet.`);
  if (getCombatState(ship)?.outOfAction) errors.push(`${ship.name} is out of action.`);
  if (hasDeclaredBoarding(ship) || getBoardingState(ship)?.drawn) errors.push(`${ship.name} is committed to a boarding action.`);
  if (isWeaponDisabledByCritical(launcher, getCriticalState(ship))) errors.push(`${launcher.name} is disabled by critical damage.`);
  return errors;
}

async function confirmOverride(errors, title) {
  if (!errors.length) return true;
  if (!game.user?.isGM) {
    ui.notifications.warn(errors.join(" "));
    return false;
  }
  return foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>${errors.map(value => foundry.utils.escapeHTML(value)).join(" ")}</p><p>Continue as a Gamemaster override?</p>`,
    yes: { label: "Continue Override", icon: "fa-solid fa-unlock" },
    no: { label: "Cancel" },
    rejectClose: false,
    modal: true
  });
}

export async function launchSelectedShipTorpedoes() {
  const ship = selectedToken();
  if (!ship) return false;
  const shipData = getShipData(ship);
  const launcher = torpedoLauncher(shipData);
  if (!launcher) {
    ui.notifications.warn(`${ship.name} has no configured torpedo launcher.`);
    return false;
  }
  const fleetId = getTokenFleetId(ship);
  if (!await confirmOverride(launchErrors(ship, fleetId, launcher), "Override Torpedo Launch Restriction?")) return false;
  const state = getOrdnanceState(ship);
  if (!state.torpedoesLoaded) {
    ui.notifications.warn(`${ship.name}'s torpedoes must be reloaded before launching again.`);
    return false;
  }

  const combat = getCombatState(ship);
  const profileStrength = Math.max(0, Math.trunc(Number(launcher.strength)));
  const strength = effectiveOrdnanceStrength(ship, profileStrength);
  const weaponHeading = normalise(
    Number(ship.document.rotation ?? 0) + Number(launcher.directionDegrees ?? -90) + 90
  );
  const halfArc = Math.max(0, Number(launcher.arcDegrees ?? 0) / 2);
  const arcStart = normalise(weaponHeading - halfArc);
  const arcSize = halfArc * 2;
  let launchRotation = weaponHeading;
  let launchThroughBlastMarker = false;
  while (true) {
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: `Torpedo Launch Bearing: ${ship.name}` },
      content: `<div class="bfg-dialog">
        <p>Choose a bearing inside ${foundry.utils.escapeHTML(launcher.name)}'s ${launcher.arcDegrees}-degree fire arc.</p>
        <div class="bfg-bearing-dial bfg-bearing-arc-dial" data-arc-centre="${weaponHeading}" data-arc-half="${halfArc}" style="--bfg-arc-start: ${arcStart}deg; --bfg-arc-size: ${arcSize}deg" title="Click inside the highlighted fire arc">
          <span class="bfg-bearing-needle" style="transform: translateX(-50%) rotate(${launchRotation}deg)"></span>
          <span class="bfg-bearing-centre"></span>
          <input type="hidden" name="rotation" value="${launchRotation}">
          <output>${launchRotation} degrees</output>
        </div>
        <small>Highlighted launch bearings: ${normalise(weaponHeading - halfArc)} to ${normalise(weaponHeading + halfArc)} degrees.</small>
      </div>`,
      ok: { label: "Launch Salvo", icon: "fa-solid fa-rocket" },
      rejectClose: false,
      modal: true
    });
    if (!result) return false;
    launchRotation = normalise(Number(result.rotation));
    if (Math.abs(signedDifference(launchRotation, weaponHeading)) <= halfArc + 0.000001) {
      drawTorpedoLaunchPreview(ship, launchRotation, Number(launcher.speedCm));
      const confirmation = await foundry.applications.api.DialogV2.input({
        window: { title: "Confirm Torpedo Launch Course" },
        content: `<div class="bfg-dialog">
          <p>The salvo's starting position and full ${launcher.speedCm} cm movement path are displayed on the canvas.</p>
          <label><input type="checkbox" name="throughBlastMarker" ${launchThroughBlastMarker ? "checked" : ""}> Launch path passes through one or more Blast Markers</label>
          <small>Close this window to return to bearing selection.</small>
        </div>`,
        ok: { label: "Place Salvo", icon: "fa-solid fa-rocket" },
        rejectClose: false,
        modal: false
      });
      if (confirmation) {
        launchThroughBlastMarker = Boolean(confirmation.throughBlastMarker);
        break;
      }
      clearOrdnanceMovementPreview();
      continue;
    }
    ui.notifications.warn(`Choose a bearing inside the ${launcher.arcDegrees}-degree torpedo fire arc.`);
  }
  if (launchThroughBlastMarker) {
    const blastRoll = await new Roll("1d6").evaluate();
    await publishBFGDice(blastRoll, {
      speaker: ChatMessage.getSpeaker({ token: ship.document }),
      flavor: `${ship.name}: Torpedo launch through Blast Markers`
    });
    if (blastRoll.total === 6) {
      await ship.document.setFlag(MODULE_ID, ORDNANCE_STATE_FLAG, {
        ...state,
        torpedoesLoaded: false
      });
      clearOrdnanceMovementPreview();
      ui.notifications.warn(`${ship.name}'s torpedo salvo detonated prematurely in the Blast Markers.`);
      return true;
    }
  }
  const actor = await torpedoActor();
  const grid = Number(canvas.scene?.grid?.size ?? 100);
  const rotation = launchRotation;
  const center = torpedoDestination(ship, rotation, Number(launcher.speedCm));
  const turnState = getTurnState();
  const movedActivation = `${turnState.battleId ?? "no-battle"}:${turnState.round}:${turnState.activeFleetIndex}:ordnance:${getActingFleetIndex(turnState)}`;
  const tokenDocument = await actor.getTokenDocument({
    x: center.x - grid,
    y: center.y - grid,
    rotation,
    actorLink: false,
    disposition: ship.document.disposition,
    flags: {
      [MODULE_ID]: {
        [ORDNANCE_MARKER_FLAG]: {
          category: "torpedo",
          name: `${launcher.name} (Strength ${strength})`,
          speedCm: Number(launcher.speedCm),
          strength,
          startingStrength: strength,
          fleetId,
          sourceTokenId: ship.document.id,
          launcherId: launcher.id,
          lastMovedActivation: movedActivation,
          attackedTargets: {}
        }
      }
    }
  });
  await canvas.scene.createEmbeddedDocuments("Token", [tokenDocument.toObject()]);
  clearOrdnanceMovementPreview();
  drawOrdnanceTrail(torpedoStart(ship, rotation), center, grid * 2);
  await ship.document.setFlag(MODULE_ID, ORDNANCE_STATE_FLAG, { ...state, torpedoesLoaded: false });
  ui.notifications.info(`${ship.name} launched a Strength ${strength} torpedo salvo.`);
  return true;
}

function normalise(value) {
  let result = Number(value) % 360;
  if (result < 0) result += 360;
  return result;
}

function bearing(from, to) {
  return normalise(Math.atan2(to.x - from.x, -(to.y - from.y)) * 180 / Math.PI);
}

function signedDifference(first, second) {
  let difference = normalise(first) - normalise(second);
  if (difference > 180) difference -= 360;
  if (difference <= -180) difference += 360;
  return difference;
}

function armourTarget(target, attacker) {
  const combat = getCombatState(target);
  const relative = Math.abs(signedDifference(
    bearing(target.center, attacker.center),
    target.document.rotation
  ));
  const facing = relative <= 45 ? "Prow" : relative >= 135 ? "Aft" : "Abeam";
  const armour = facing === "Prow" ? combat.armourFront : combat.armourOther;
  const targetNumber = Number(String(armour ?? combat.armour).match(/\d+/)?.[0]);
  if (!(targetNumber >= 2 && targetNumber <= 6)) throw new Error("The target has no valid Armour value.");
  return { facing, targetNumber };
}

function fullRoundKey() {
  const state = getTurnState();
  return `${state.battleId ?? "no-battle"}:${state.round}`;
}

export async function resolveSelectedTorpedoAttack() {
  const salvo = selectedToken();
  if (!salvo) return false;
  const marker = getOrdnanceMarker(salvo);
  if (marker?.category !== "torpedo") {
    ui.notifications.warn("Select exactly one BFG torpedo salvo.");
    return false;
  }
  const targets = [...(game.user?.targets ?? [])];
  if (targets.length !== 1) {
    ui.notifications.warn("Use Foundry targeting to select exactly one ship crossed by the salvo's recorded path.");
    return false;
  }
  const target = targets[0];
  const combat = getCombatState(target);
  if (!combat) {
    ui.notifications.warn(`${target.name} is not a configured ship.`);
    return false;
  }
  const state = getTurnState();
  const errors = [];
  if (!state.battleStarted) errors.push("No battle is in progress.");
  if (!['movement', 'ordnance'].includes(state.phase)) errors.push("Torpedo contact attacks resolve during Movement or Ordnance.");
  const previousAttack = marker.attackedTargets?.[fullRoundKey()] ?? [];
  if (previousAttack.includes(target.document.id)) errors.push(`${salvo.name} has already attacked ${target.name} this full round.`);
  if (!await confirmOverride(errors, "Override Torpedo Attack Restriction?")) return false;
  const armourPreview = armourTarget(target, salvo);
  return openActionResolution({
    heading: "Torpedo attack",
    rollLabel: "Roll torpedo attack",
    applyLabel: "Apply damage and salvo losses",
    detailsHtml: `<div class="bfg-dialog bfg-action-confirmation">
      <h3>Torpedo salvo resolution</h3>
      <div><span>Salvo</span><strong>${foundry.utils.escapeHTML(salvo.name)}</strong></div>
      <div><span>Current strength</span><strong>${Math.max(0, Number(marker.strength))}</strong></div>
      <div><span>Target</span><strong>${foundry.utils.escapeHTML(target.name)}</strong></div>
      <div><span>Target armour</span><strong>${armourPreview.targetNumber}+</strong></div>
      <div><span>Turret dice</span><strong>Up to ${Math.max(0, Number(combat.effectiveTurrets) || 0)}d6, needing 4+</strong></div>
      <div><span>Attack dice</span><strong>Up to ${Math.max(0, Number(marker.strength))}d6, needing ${armourPreview.targetNumber}+</strong></div>
      <div><span>Critical checks</span><strong>1d6 per hit, needing 6</strong></div>
      <p>Turrets fire first. Surviving torpedoes roll against Armour, ignore shields, and lose one Strength for every hit inflicted.</p>
      <p>Confirm that the recorded movement trail crossed this target's base.</p>
      ${combat.hulk ? "" : braceReactionControls(target)}
    </div>`,
    readOptions: element => readBraceReactionOptions(element),
    roll: async options => {
      if (!combat.hulk) await resolveBraceReaction(target, options);
      const defenseChoice = getTurretDefenseChoice(target);
      const turretDice = defenseChoice === "attackCraft" ? 0 : Math.max(0, Number(combat.effectiveTurrets) || 0);
      const turretRoll = await new Roll(turretDice ? `${turretDice}d6` : "0").evaluate();
      await publishBFGDice(turretRoll, { speaker: ChatMessage.getSpeaker({ token: target.document }), flavor: `${target.name}: Turrets defending against ${salvo.name}` });
      const turretResults = diceFaces(turretRoll);
      const shotDown = turretResults.filter(value => value >= 4).length;
      const attackingStrength = Math.max(0, Number(marker.strength) - shotDown);
      const attackRoll = await new Roll(attackingStrength ? `${attackingStrength}d6` : "0").evaluate();
      await publishBFGDice(attackRoll, { speaker: ChatMessage.getSpeaker({ token: salvo.document }), flavor: `${salvo.name} attacking ${target.name}` });
      const attackResults = diceFaces(attackRoll);
      const hits = attackResults.filter(value => value >= armourPreview.targetNumber).length;
      const brace = combat.hulk ? { dice: [], saved: 0, unsaved: hits } : await rollBraceSaves(target, hits, "Brace saves against torpedoes");
      const critical = combat.hulk ? { after: getCriticalState(target), escortDestroyed: false, extraDamage: 0 } : await rollCriticalHits(target, brace.unsaved);
      const remainingHull = combat.hulk ? 0 : critical.escortDestroyed ? 0 : Math.max(0, combat.currentHits - brace.unsaved - critical.extraDamage);
      const catastrophic = (combat.hulk && hits > 0) || (!combat.outOfAction && remainingHull <= 0) ? await rollCatastrophicDamage(target) : null;
      const remainingStrength = Math.max(0, attackingStrength - hits);
      const criticalChecks = critical.checkResults?.join(", ") || "None";
      const criticalEffects = critical.escortDestroyed ? "Escort destroyed" : critical.results?.map(result => `${result.name}${result.shifted ? ` (table result ${result.appliedTotal})` : ""}${result.extraDamage ? ` (+${result.extraDamage} damage)` : ""}`).join("; ") || "None";
      const catastrophicResult = catastrophic ? `${catastrophic.name}${catastrophic.tableTotal ? ` (${catastrophic.tableTotal})` : ""}` : "None";
      const outcome = {
        defenseChoice, turretDice, turretResults, shotDown, attackingStrength, attackResults, hits, brace, critical, catastrophic, remainingHull, remainingStrength, criticalChecks, criticalEffects, catastrophicResult,
        resultHtml: `<h3>Attack result</h3><div class="bfg-action-confirmation"><div><span>Turret dice (${turretDice}d6, needing 4+)</span><strong>${turretResults.join(", ") || "None"}</strong></div><div><span>Torpedoes shot down</span><strong>${shotDown}</strong></div><div><span>Attack dice (${attackingStrength}d6, needing ${armourPreview.targetNumber}+)</span><strong>${attackResults.join(", ") || "None"}</strong></div><div><span>Hits</span><strong>${hits}</strong></div><div><span>Brace saves (${hits}d6, needing 4+)</span><strong>${brace.dice.join(", ") || "None"}; saved ${brace.saved}</strong></div><div><span>Critical checks (${brace.unsaved}d6, needing 6)</span><strong>${criticalChecks}</strong></div><div><span>Critical effects</span><strong>${foundry.utils.escapeHTML(criticalEffects)}</strong></div><div><span>Critical damage</span><strong>${critical.extraDamage ?? 0}</strong></div><div><span>Catastrophic result</span><strong>${foundry.utils.escapeHTML(catastrophicResult)}</strong></div><div><span>Remaining hull</span><strong>${remainingHull}</strong></div><div><span>Remaining salvo Strength</span><strong>${remainingStrength}</strong></div></div><p>Shields are ignored. Review this result before applying it.</p>`
      };
      await playTorpedoReplayAnimation({ salvo, target, outcome, speedCm: marker.speedCm });
      return outcome;
    },
    apply: async outcome => {
      const currentCombat = getCombatState(target);
      const currentMarker = getOrdnanceMarker(salvo);
      if (!currentCombat || currentCombat.currentHits !== combat.currentHits || currentCombat.currentShields !== combat.currentShields || Number(currentMarker?.strength) !== Number(marker.strength)) throw new Error("The target or salvo changed after the roll. Resolve the attack again.");
      if (!outcome.defenseChoice && outcome.turretDice > 0) await commitTurretDefenseChoice(target, "torpedo");
      if (!combat.hulk) await setCriticalState(target, outcome.critical.after);
      if (outcome.catastrophic) await setCatastrophicState(target, outcome.catastrophic);
      await setCombatState(target, { currentHits: outcome.remainingHull, currentShields: combat.currentShields });
      if (outcome.remainingStrength <= 0) await salvo.document.delete();
      else {
        const attackedTargets = { ...(marker.attackedTargets ?? {}) };
        attackedTargets[fullRoundKey()] = [...new Set([...(attackedTargets[fullRoundKey()] ?? []), target.document.id])];
        await salvo.document.update({ name: `Torpedo Salvo (Strength ${outcome.remainingStrength})`, [`flags.${MODULE_ID}.${ORDNANCE_MARKER_FLAG}.strength`]: outcome.remainingStrength, [`flags.${MODULE_ID}.${ORDNANCE_MARKER_FLAG}.name`]: `Torpedo Salvo (Strength ${outcome.remainingStrength})`, [`flags.${MODULE_ID}.${ORDNANCE_MARKER_FLAG}.attackedTargets`]: attackedTargets });
      }
      await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ token: salvo.document }), content: `<div class="bfg-dice-chat-result"><strong>Torpedo attack on ${foundry.utils.escapeHTML(target.name)}</strong><br>Turrets: ${outcome.turretResults.join(", ") || "None"}; Strength removed: ${outcome.shotDown}<br>Attack dice: ${outcome.attackResults.join(", ") || "None"}; Armour: ${armourPreview.targetNumber}+ (${armourPreview.facing}); Hits: ${outcome.hits}; shields ignored<br>Brace saves: ${outcome.brace.dice.join(", ") || "None"}; damage saved: ${outcome.brace.saved}<br>Critical checks: ${outcome.criticalChecks}; critical effects: ${foundry.utils.escapeHTML(outcome.criticalEffects)}; critical damage: ${outcome.critical.extraDamage ?? 0}<br>Catastrophic result: ${foundry.utils.escapeHTML(outcome.catastrophicResult)}; remaining hull: ${outcome.remainingHull}; remaining salvo Strength: ${outcome.remainingStrength}</div>` });
    }
  });
}
