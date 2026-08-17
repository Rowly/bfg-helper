import { getShipData } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getCombatState, halveRoundedUp, previewHitDamage, setCombatState } from "./combat-state.js";
import { getCriticalState, rollCriticalHits, setCriticalState } from "./critical-hits.js";
import { getCatastrophicState, rollCatastrophicDamage, setCatastrophicState } from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { getOrdnanceMarker } from "./ordnance.js";
import { openActionResolution } from "./action-resolution-app.js";
import { getShootingContext, getSelectedShootingTarget, markWeaponFired } from "./shooting.js";
import { braceReactionControls, readBraceReactionOptions, resolveBraceReaction, rollBraceSaves } from "./special-orders.js";
import { getEffectiveLeadership } from "./leadership.js";
import { playNovaCannonAnimation } from "./shooting-effects.js";

const TEMPLATE_DIAMETER_CM = 5;
const TEMPLATE_RADIUS_CM = TEMPLATE_DIAMETER_CM / 2;
const HOLE_DIAMETER_CM = 1.2;
const HOLE_RADIUS_CM = HOLE_DIAMETER_CM / 2;
const MAXIMUM_SCATTER_CM = 18;

function pixelsPerCm() {
  const size = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  if (!(size > 0) || !(distance > 0)) throw new Error("The Scene needs a valid grid size and distance.");
  return size / distance;
}

function normaliseDegrees(value) {
  let result = Number(value) % 360;
  if (result < 0) result += 360;
  return result;
}

function signedDifference(first, second) {
  let value = normaliseDegrees(first) - normaliseDegrees(second);
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return value;
}

function heading(from, to) {
  return normaliseDegrees(Math.atan2(Number(to.x) - Number(from.x), Number(from.y) - Number(to.y)) * 180 / Math.PI);
}

function tokenRadius(token) {
  const width = Number(token.document?.width ?? 1) * Number(canvas.grid?.size ?? 100);
  const height = Number(token.document?.height ?? 1) * Number(canvas.grid?.size ?? 100);
  return Math.min(width, height) / 2;
}

function overlaps(token, point, radiusPixels) {
  return Math.hypot(token.center.x - point.x, token.center.y - point.y) <= tokenRadius(token) + radiusPixels;
}

function placementAnalysis(attacker, weapon, point, designatedTarget) {
  const scale = pixelsPerCm();
  const distanceCm = Math.hypot(point.x - attacker.center.x, point.y - attacker.center.y) / scale;
  const bearing = heading(attacker.center, point);
  const weaponHeading = Number(attacker.document.rotation ?? 0) + Number(weapon.directionDegrees ?? -90) + 90;
  const inArc = Math.abs(signedDifference(bearing, weaponHeading)) <= Number(weapon.arcDegrees ?? 90) / 2 + 0.000001;
  const minimum = Number(weapon.minimumRangeCm ?? 30);
  const maximum = Number(weapon.rangeCm ?? 150);
  const nearestEdgeCm = distanceCm - TEMPLATE_RADIUS_CM;
  const inRange = nearestEdgeCm >= minimum - 0.000001 && nearestEdgeCm <= maximum + 0.000001;
  const coversTarget = overlaps(designatedTarget, point, TEMPLATE_RADIUS_CM * scale);
  const attackerFleet = getTokenFleetId(attacker);
  const friendlyContact = (canvas.tokens?.placeables ?? []).some(token =>
    token.id !== attacker.id && getShipData(token) && getTokenFleetId(token) === attackerFleet && overlaps(token, point, TEMPLATE_RADIUS_CM * scale)
  );
  return { distanceCm, bearing, inArc, inRange, coversTarget, friendlyContact, legal: inArc && inRange && coversTarget && !friendlyContact };
}

function drawTemplate(graphics, point, legal) {
  const scale = pixelsPerCm();
  graphics.clear();
  graphics.lineStyle(Math.max(2, scale * 0.08), legal ? 0xffcc66 : 0xff5533, 0.95);
  graphics.beginFill(legal ? 0xffcc66 : 0xff5533, 0.16);
  graphics.drawCircle(point.x, point.y, TEMPLATE_RADIUS_CM * scale);
  graphics.endFill();
  graphics.lineStyle(Math.max(2, scale * 0.05), 0xffffff, 0.9);
  graphics.drawCircle(point.x, point.y, HOLE_RADIUS_CM * scale);
}

function updateRangeLabel(label, point, analysis) {
  const scale = pixelsPerCm();
  const nearestEdgeCm = Math.max(0, analysis.distanceCm - TEMPLATE_RADIUS_CM);
  label.text = `Range: ${nearestEdgeCm.toFixed(1)} cm${analysis.inRange ? "" : " (out of range)"}`;
  label.style.fill = analysis.inRange ? 0xffcc66 : 0xff7766;
  label.position.set(
    point.x + TEMPLATE_RADIUS_CM * scale + Math.max(8, scale * 0.2),
    point.y - label.height / 2
  );
}

function showResolvedTemplate(aimPoint, finalPoint) {
  const graphics = new PIXI.Graphics();
  const scale = pixelsPerCm();
  drawTemplate(graphics, finalPoint, true);
  graphics.lineStyle(Math.max(2, scale * 0.06), 0xffcc66, 0.75);
  graphics.moveTo(aimPoint.x, aimPoint.y);
  graphics.lineTo(finalPoint.x, finalPoint.y);
  canvas.tokens.addChild(graphics);
  setTimeout(() => {
    if (!graphics.destroyed) graphics.destroy({ children: true });
  }, 15000);
}

async function chooseAimPoint(attacker, weapon, designatedTarget) {
  const view = canvas.app?.view ?? canvas.app?.canvas;
  if (!view) throw new Error("The canvas is not ready for Nova Cannon placement.");
  const graphics = new PIXI.Graphics();
  const rangeLabel = new PIXI.Text("", {
    fontFamily: "Arial, sans-serif",
    fontSize: Math.max(18, pixelsPerCm() * 0.45),
    fontWeight: "bold",
    fill: 0xffcc66,
    stroke: 0x000000,
    strokeThickness: 4
  });
  graphics.addChild(rangeLabel);
  canvas.tokens.addChild(graphics);
  ui.notifications.info("Move the Nova Cannon template over the designated target and click to place it. Right-click to cancel.");

  return new Promise(resolve => {
    let current = { x: designatedTarget.center.x, y: designatedTarget.center.y };
    const canvasPoint = event => {
      const rect = view.getBoundingClientRect();
      const screen = new PIXI.Point(
        (event.clientX - rect.left) * canvas.app.renderer.screen.width / rect.width,
        (event.clientY - rect.top) * canvas.app.renderer.screen.height / rect.height
      );
      return canvas.stage.toLocal(screen);
    };
    const cleanup = () => {
      view.removeEventListener("pointermove", move);
      view.removeEventListener("pointerdown", down);
      view.removeEventListener("contextmenu", cancel);
      graphics.destroy({ children: true });
    };
    const move = event => {
      current = canvasPoint(event);
      const analysis = placementAnalysis(attacker, weapon, current, designatedTarget);
      drawTemplate(graphics, current, analysis.legal);
      updateRangeLabel(rangeLabel, current, analysis);
    };
    const down = event => {
      if (event.button !== 0) return;
      const analysis = placementAnalysis(attacker, weapon, current, designatedTarget);
      if (!analysis.legal) {
        const reason = !analysis.inRange ? "The template's nearest edge must be between 30 and 150 cm."
          : !analysis.inArc ? "The template is outside the Nova Cannon's prow arc."
            : !analysis.coversTarget ? "The template must touch the designated target."
              : "The template may not touch a friendly ship when placed.";
        ui.notifications.warn(reason);
        return;
      }
      cleanup();
      resolve({ point: { x: current.x, y: current.y }, analysis });
    };
    const cancel = event => { event.preventDefault(); cleanup(); resolve(null); };
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerdown", down);
    view.addEventListener("contextmenu", cancel);
    const initialAnalysis = placementAnalysis(attacker, weapon, current, designatedTarget);
    drawTemplate(graphics, current, initialAnalysis.legal);
    updateRangeLabel(rangeLabel, current, initialAnalysis);
  });
}

function potentialBraceTargets(point) {
  const scale = pixelsPerCm();
  const radius = (TEMPLATE_RADIUS_CM + MAXIMUM_SCATTER_CM) * scale;
  return (canvas.tokens?.placeables ?? []).filter(token => getShipData(token) && overlaps(token, point, radius));
}

function closestEnemyShip(attacker, weapon) {
  const fleetId = getTokenFleetId(attacker);
  const scale = pixelsPerCm();
  const weaponHeading = Number(attacker.document.rotation ?? 0) + Number(weapon.directionDegrees ?? -90) + 90;
  const halfArc = Number(weapon.arcDegrees ?? 90) / 2;
  const maximumRangeCm = Number(weapon.rangeCm ?? 150);
  return (canvas.tokens?.placeables ?? [])
    .filter(token => token.id !== attacker.id && getShipData(token) && getTokenFleetId(token) && getTokenFleetId(token) !== fleetId && !getCombatState(token)?.outOfAction)
    .map(token => ({
      token,
      distanceCm: Math.hypot(token.center.x - attacker.center.x, token.center.y - attacker.center.y) / scale,
      inArc: Math.abs(signedDifference(heading(attacker.center, token.center), weaponHeading)) <= halfArc + 0.000001,
      reachable: Math.hypot(token.center.x - attacker.center.x, token.center.y - attacker.center.y) / scale
        <= maximumRangeCm + TEMPLATE_RADIUS_CM + tokenRadius(token) / scale + 0.000001
    }))
    .filter(candidate => candidate.inArc && candidate.reachable)
    .sort((first, second) => first.distanceCm - second.distanceCm)[0] ?? null;
}

function scatterDiceForRange(rangeCm) {
  if (rangeCm <= 45) return 1;
  if (rangeCm <= 60) return 2;
  return 3;
}

async function rollPublished(formula, flavor, token) {
  const roll = await new Roll(formula).evaluate();
  await publishBFGDice(roll, { speaker: ChatMessage.getSpeaker({ token: token.document }), flavor });
  return roll;
}

async function showRollWithoutNumericChat(roll) {
  if (game.dice3d?.showForRoll) await game.dice3d.showForRoll(roll, game.user, true);
}

async function previewShipDamage(target, hits) {
  const before = getCombatState(target);
  const hulk = before.hulk;
  let damage = previewHitDamage(target, hulk ? 0 : hits);
  const brace = hulk ? { dice: [], saved: 0, unsaved: 0 } : await rollBraceSaves(target, damage.hullHits, "Nova Cannon Brace for Impact saves");
  if (brace.saved) damage = previewHitDamage(target, damage.shieldHits + brace.unsaved);
  const critical = hulk ? await rollCriticalHits(target, 0) : await rollCriticalHits(target, damage.hullHits);
  const remainingHull = hulk ? 0 : critical.escortDestroyed ? 0 : Math.max(0, damage.after.currentHits - critical.extraDamage);
  damage.critical = critical;
  damage.brace = brace;
  damage.extraCriticalDamage = critical.extraDamage;
  damage.after.currentHits = remainingHull;
  damage.after.crippled = remainingHull > 0 && remainingHull <= damage.before.maximumHits / 2;
  const maximumShields = critical.after.permanent.includes("shields-collapse") ? 0
    : damage.after.crippled ? halveRoundedUp(damage.before.profileMaximumShields) : damage.before.profileMaximumShields;
  damage.after.currentShields = Math.min(damage.after.currentShields, maximumShields);
  damage.after.outOfAction = remainingHull <= 0;
  damage.catastrophic = (hulk && hits > 0) || (!damage.before.outOfAction && damage.after.outOfAction)
    ? await rollCatastrophicDamage(target) : null;
  return damage;
}

function criticalSummary(critical) {
  if (critical.escortDestroyed) return "Escort destroyed";
  return critical.results?.map(result => `${result.name}${result.extraDamage ? ` (+${result.extraDamage} damage)` : ""}`).join("; ") || "None";
}

function catastrophicSummary(catastrophic) {
  return catastrophic ? `${catastrophic.name}${catastrophic.tableTotal ? ` (2D6: ${catastrophic.tableTotal})` : ""}` : "None";
}

async function resolveNova(attacker, weapon, placement, braceTargets, options) {
  for (const target of braceTargets) {
    const setting = options.brace?.[target.id] ?? {};
    await resolveBraceReaction(target, setting);
  }

  let aimPoint = placement.point;
  let aimAnalysis = placement.analysis;
  let leadershipCheck = null;
  const closest = closestEnemyShip(attacker, weapon);
  if (closest?.distanceCm > 30 && !overlaps(closest.token, aimPoint, TEMPLATE_RADIUS_CM * pixelsPerCm())) {
    const leadership = getEffectiveLeadership(attacker);
    const roll = await new Roll("2d6").evaluate();
    const total = Number(roll.total);
    const passed = total <= leadership;
    await publishBFGDice(roll, {
      speaker: ChatMessage.getSpeaker({ token: attacker.document }),
      flavor: `${weapon.name}: target-priority Leadership test`,
      details: `Total ${total} against Leadership ${leadership}: ${passed ? "PASS" : "FAIL; shot redirected to the closest eligible enemy"}.`
    });
    leadershipCheck = { dice: diceFaces(roll), total, leadership, passed };
    if (!leadershipCheck.passed) {
      const requiredCentreRange = Math.max(closest.distanceCm, Number(weapon.minimumRangeCm ?? 30) + TEMPLATE_RADIUS_CM);
      const bearingRadians = heading(attacker.center, closest.token.center) * Math.PI / 180;
      aimPoint = {
        x: attacker.center.x + Math.sin(bearingRadians) * requiredCentreRange * pixelsPerCm(),
        y: attacker.center.y - Math.cos(bearingRadians) * requiredCentreRange * pixelsPerCm()
      };
      aimAnalysis = placementAnalysis(attacker, weapon, aimPoint, closest.token);
    }
  }

  const scatterDice = scatterDiceForRange(aimAnalysis.distanceCm);
  const scatterFaceRoll = await new Roll("1d6").evaluate();
  await showRollWithoutNumericChat(scatterFaceRoll);
  const scatterFace = diceFaces(scatterFaceRoll)[0];
  const directHit = scatterFace <= 2;
  let direction = null;
  let distanceDice = [];
  let scatterCm = 0;
  if (!directHit) {
    const directionRoll = await new Roll("1d360").evaluate();
    await showRollWithoutNumericChat(directionRoll);
    direction = Number(directionRoll.total);
    const distanceRoll = await rollPublished(`${scatterDice}d6`, `${weapon.name}: scatter distance`, attacker);
    distanceDice = diceFaces(distanceRoll);
    scatterCm = Number(distanceRoll.total);
  }
  const scatterLabel = directHit ? "HIT" : `Arrow, ${direction} degrees`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attacker.document }),
    content: `<div class="bfg-dice-chat-result"><strong>${foundry.utils.escapeHTML(weapon.name)}</strong><br>Scatter die: <strong>${scatterLabel}</strong></div>`
  });
  const radians = Number(direction ?? 0) * Math.PI / 180;
  const scale = pixelsPerCm();
  const finalPoint = directHit ? aimPoint : {
    x: aimPoint.x + Math.sin(radians) * scatterCm * scale,
    y: aimPoint.y - Math.cos(radians) * scatterCm * scale
  };
  const contactedShips = (canvas.tokens?.placeables ?? []).filter(token => getShipData(token) && overlaps(token, finalPoint, TEMPLATE_RADIUS_CM * scale));
  const contactedOrdnance = (canvas.tokens?.placeables ?? []).filter(token => getOrdnanceMarker(token) && overlaps(token, finalPoint, TEMPLATE_RADIUS_CM * scale));
  const shipResults = [];
  for (const target of contactedShips) {
    const central = overlaps(target, finalPoint, HOLE_RADIUS_CM * scale);
    let hits = 1;
    let damageRoll = null;
    if (central) {
      damageRoll = await rollPublished("1d6", `${weapon.name}: centre-hole damage against ${target.name}`, attacker);
      hits = Number(damageRoll.total);
    }
    shipResults.push({ target, targetId: target.id, targetName: target.name, central, hits, damage: await previewShipDamage(target, hits) });
  }
  await markWeaponFired(attacker, weapon.id, getShootingContext(attacker).state);

  const resultRows = shipResults.map(result => `<h4>${foundry.utils.escapeHTML(result.targetName)}</h4><div><span>Template contact</span><strong>${result.central ? "Centre hole, D6 hits" : "Outer template, 1 hit"}</strong></div><div><span>Hits</span><strong>${result.hits}</strong></div><div><span>Shield hits</span><strong>${result.damage.shieldHits}</strong></div><div><span>Brace saves</span><strong>${result.damage.brace.dice.join(", ") || "None"}; saved ${result.damage.brace.saved}</strong></div><div><span>Hull damage</span><strong>${result.damage.hullHits}</strong></div><div><span>Critical checks (${result.damage.critical.checks}d6, needing 6)</span><strong>${result.damage.critical.checkResults.join(", ") || "None"}</strong></div><div><span>Critical effects</span><strong>${foundry.utils.escapeHTML(criticalSummary(result.damage.critical))}</strong></div><div><span>Critical damage</span><strong>${result.damage.extraCriticalDamage}</strong></div><div><span>Catastrophic result</span><strong>${foundry.utils.escapeHTML(catastrophicSummary(result.damage.catastrophic))}</strong></div><div><span>Remaining shields</span><strong>${result.damage.after.currentShields}</strong></div><div><span>Remaining hull</span><strong>${result.damage.after.currentHits}</strong></div>${result.damage.shieldHits ? `<p>Place ${result.damage.shieldHits} Blast Marker token(s) manually for this attack's ${result.damage.shieldHits} shield hit(s).</p>` : ""}`).join("");
  return {
    attackerId: attacker.id, aimPoint, finalPoint, directHit, scatterFace, scatterDice, distanceDice, scatterCm, direction, leadershipCheck,
    shipResults, ordnanceIds: contactedOrdnance.map(token => token.id),
    resultHtml: `<h3>Nova Cannon result</h3><div class="bfg-action-confirmation">${leadershipCheck ? `<div><span>Target-priority Leadership test (2d6)</span><strong>${leadershipCheck.dice.join(", ")} = ${leadershipCheck.total} against ${leadershipCheck.leadership}: ${leadershipCheck.passed ? "passed" : "failed; shot redirected to closest enemy"}</strong></div>` : ""}<div><span>Scatter die</span><strong>${scatterLabel}</strong></div><div><span>Scatter distance (${scatterDice}d6)</span><strong>${directHit ? "None" : `${distanceDice.join(", ")} = ${scatterCm} cm`}</strong></div><div><span>Ordnance markers contacted</span><strong>${contactedOrdnance.length}</strong></div>${resultRows}</div>${shipResults.length || contactedOrdnance.length ? "" : "<p>No target was contacted. Place 1 Blast Marker token manually at the final template position.</p>"}<p>Review all results before applying damage and removing contacted ordnance.</p>`
  };
}

async function applyNova(outcome) {
  for (const result of outcome.shipResults) {
    const target = canvas.tokens?.get(result.targetId);
    if (!target) throw new Error(`${result.targetName} is no longer on the Scene.`);
    const current = getCombatState(target);
    const before = result.damage.before;
    if (current.currentHits !== before.currentHits || current.currentShields !== before.currentShields
      || JSON.stringify(getCriticalState(target)) !== JSON.stringify(result.damage.critical.before)
      || JSON.stringify(getCatastrophicState(target)) !== JSON.stringify(before.catastrophicState)) {
      throw new Error(`${result.targetName}'s state changed after the roll. Resolve the shot again.`);
    }
  }
  for (const result of outcome.shipResults) {
    const target = canvas.tokens.get(result.targetId);
    await setCriticalState(target, result.damage.critical.after);
    if (result.damage.catastrophic) await setCatastrophicState(target, result.damage.catastrophic);
    await setCombatState(target, result.damage.after);
  }
  const ordnanceIds = outcome.ordnanceIds.filter(id => canvas.tokens?.get(id));
  if (ordnanceIds.length) await canvas.scene.deleteEmbeddedDocuments("Token", ordnanceIds);
  const summary = outcome.shipResults.map(result => `${foundry.utils.escapeHTML(result.targetName)}: ${result.hits} hit(s), ${result.damage.shieldHits} shield hit(s), ${result.damage.hullHits} hull damage, ${foundry.utils.escapeHTML(criticalSummary(result.damage.critical))}, ${result.damage.after.currentHits} hull remaining`).join("<br>");
  await ChatMessage.create({ content: `<div class="bfg-shooting-chat-result"><strong>Nova Cannon resolved</strong><br>Scatter die: ${outcome.directHit ? "HIT" : `Arrow, ${outcome.direction} degrees`}. Scatter distance: ${outcome.directHit ? "None" : `${outcome.scatterCm} cm`}.<br>${summary || "No ship contacted."}<br>Ordnance removed: ${ordnanceIds.length}.</div>` });
}

export async function openNovaCannon(attacker, weapon, designatedTarget = getSelectedShootingTarget()) {
  const context = getShootingContext(attacker);
  if (!context.ok) throw new Error(context.error);
  if (!designatedTarget) throw new Error("Designate exactly one target before placing the Nova Cannon template.");
  if (String(weapon?.type ?? "").toLowerCase() !== "nova-cannon") throw new Error("Select a Nova Cannon.");
  if (context.combatState.novaCannonDisabled) throw new Error("A crippled ship cannot fire its Nova Cannon.");
  if (context.combatState.outOfAction) throw new Error("An out-of-action ship cannot fire.");
  const current = getShootingContext(context.token);
  const configured = current.weapons.find(item => item.id === weapon.id);
  if (!configured) throw new Error("The Nova Cannon is no longer configured on this ship.");
  const directPreview = (await import("./shooting.js")).analyseDirectFire(attacker, designatedTarget, configured);
  if (directPreview.weaponFired) throw new Error(`${configured.name} has already fired during this Shooting phase.`);
  if (directPreview.weaponDisabled) throw new Error(`${configured.name} is disabled by critical damage.`);
  if (directPreview.novaOrderBlocked) throw new Error(`${configured.name} cannot fire under the ship's current Special Order.`);
  const placement = await chooseAimPoint(attacker, configured, designatedTarget);
  if (!placement) return false;
  const closest = closestEnemyShip(attacker, configured)?.token;
  const braceTargets = [...new Map([...potentialBraceTargets(placement.point), ...(closest ? [closest] : [])].map(token => [token.id, token])).values()];
  const braceHtml = braceTargets.map(target => `<fieldset><legend>${foundry.utils.escapeHTML(target.name)}</legend>${braceReactionControls(target, `brace-${target.id}`)}</fieldset>`).join("");
  return openActionResolution({
    heading: `${attacker.name}: ${configured.name}`,
    detailsHtml: `<div class="bfg-action-confirmation"><div><span>Designated target</span><strong>${foundry.utils.escapeHTML(designatedTarget.name)}</strong></div><div><span>Template centre range</span><strong>${placement.analysis.distanceCm.toFixed(1)} cm</strong></div><div><span>Template</span><strong>5 cm diameter; 1.2 cm centre hole</strong></div><div><span>Scatter distance</span><strong>${scatterDiceForRange(placement.analysis.distanceCm)}d6</strong></div></div><p>Declare Brace for Impact now for ships which the shot could contact after scattering.</p>${braceHtml || "<p>No configured ship could be contacted by the maximum scatter.</p>"}`,
    rollLabel: "Fire Nova Cannon",
    applyLabel: "Apply Nova Cannon result",
    readOptions: element => ({ brace: Object.fromEntries(braceTargets.map(target => [target.id, readBraceReactionOptions(element, `brace-${target.id}`)])) }),
    roll: async options => {
      const outcome = await resolveNova(attacker, configured, placement, braceTargets, options);
      await playNovaCannonAnimation(outcome);
      showResolvedTemplate(outcome.aimPoint, outcome.finalPoint);
      return outcome;
    },
    apply: applyNova
  });
}
