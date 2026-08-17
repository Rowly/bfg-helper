import { getShipData } from "./ship-data.js";
import { getTokenFleetId } from "./fleet-assignment.js";
import { getCombatState, setCombatState } from "./combat-state.js";
import { rollCriticalHits, setCriticalState } from "./critical-hits.js";
import { rollCatastrophicDamage, setCatastrophicState } from "./catastrophic-damage.js";
import { diceFaces, publishBFGDice } from "./dice.js";
import { openActionResolution } from "./action-resolution-app.js";
import {
  attemptBraceForImpact,
  getSpecialOrder,
  rollBraceSaves
} from "./special-orders.js";
import { getEffectiveLeadership } from "./leadership.js";

const RAMMING_SIZE_RANK = Object.freeze({ escort: 1, cruiser: 2, battleship: 3, defence: 4 });

function normaliseDegrees(value) {
  let result = Number(value) % 360;
  if (result < 0) result += 360;
  return result;
}

function signedAngleDifference(first, second) {
  let difference = normaliseDegrees(first) - normaliseDegrees(second);
  if (difference > 180) difference -= 360;
  if (difference <= -180) difference += 360;
  return difference;
}

function headingToPoint(from, to) {
  return normaliseDegrees(Math.atan2(Number(to.x) - Number(from.x), -(Number(to.y) - Number(from.y))) * 180 / Math.PI);
}

function armourNumber(value) {
  const number = Number(String(value ?? "").match(/\d+/)?.[0]);
  if (!(number >= 2 && number <= 6)) throw new Error("A ramming participant has an invalid Armour value.");
  return number;
}

export function rammingSize(tokenOrDocument) {
  const data = getShipData(tokenOrDocument);
  const explicit = String(data?.stats?.rammingSize ?? "").toLowerCase();
  if (RAMMING_SIZE_RANK[explicit]) return explicit;
  const profileId = String(data?.profileId ?? "");
  if (["imperial-retribution", "chaos-despoiler"].includes(profileId)) return "battleship";
  if (String(data?.stats?.targetClass ?? "").toLowerCase() === "escort") return "escort";
  if (String(data?.stats?.targetClass ?? "").toLowerCase() === "defence") return "defence";
  return "cruiser";
}

function ramLeadershipDice(rammer, target) {
  const rammerRank = RAMMING_SIZE_RANK[rammingSize(rammer)];
  const targetRank = RAMMING_SIZE_RANK[rammingSize(target)];
  return targetRank < rammerRank ? 3 : targetRank === rammerRank ? 2 : 1;
}

function availableRamTargets(rammer) {
  const rammerFleet = getTokenFleetId(rammer);
  return (canvas.tokens?.placeables ?? []).filter(target => {
    const combat = getCombatState(target);
    return target.document.id !== rammer.document.id
      && getShipData(target)
      && combat
      && !combat.outOfAction
      && getTokenFleetId(target)
      && getTokenFleetId(target) !== rammerFleet;
  });
}

export async function prepareRammingDeclaration(rammer) {
  const targets = availableRamTargets(rammer);
  if (!targets.length) {
    ui.notifications.info("No operational enemy ships are available as ram targets. All Ahead Full continues without a ram declaration.");
    return null;
  }
  const targetedId = [...(game.user?.targets ?? [])]
    .find(target => targets.some(candidate => candidate.document.id === target.document.id))?.document.id;
  const options = targets.map(target => `<option value="${target.document.id}" ${target.document.id === targetedId ? "selected" : ""}>${foundry.utils.escapeHTML(target.name)}</option>`).join("");
  const choice = await foundry.applications.api.DialogV2.input({
    window: { title: `Declare Ram: ${rammer.name}` },
    content: `<div class="bfg-dialog"><label>Ram target</label><select name="targetId">${options}</select><p>Select the enemy vessel this ship will attempt to ram. The target cannot be changed after the Leadership test.</p></div>`,
    ok: { label: "Declare Ram", icon: "fa-solid fa-angles-up" },
    rejectClose: false,
    modal: true
  });
  if (!choice) return null;
  const target = targets.find(candidate => candidate.document.id === String(choice.targetId ?? ""));
  if (!target) throw new Error("The selected ram target is no longer available.");
  const dice = ramLeadershipDice(rammer, target);
  const leadership = getEffectiveLeadership(rammer);
  const roll = await new Roll(`${dice}d6`).evaluate();
  const passed = Number(roll.total) <= leadership;
  await publishBFGDice(roll, {
    speaker: ChatMessage.getSpeaker({ token: rammer.document }),
    flavor: `${rammer.name}: Leadership test to ram ${target.name}`,
    details: `Total ${roll.total} against Leadership ${leadership}: ${passed ? "PASS; ram attempt declared" : "FAIL; ram attempt failed"}.`
  });
  return { declared: true, targetId: target.document.id, targetName: target.name, dice, results: diceFaces(roll), total: Number(roll.total), leadership, passed };
}

export function findRamContact(rammer, target, start, end) {
  if (!rammer || !target) return null;
  const dx = Number(end.x) - Number(start.x);
  const dy = Number(end.y) - Number(start.y);
  const fx = Number(start.x) - Number(target.center.x);
  const fy = Number(start.y) - Number(target.center.y);
  const radius = Math.min(Number(rammer.w), Number(rammer.h)) / 2 + Math.min(Number(target.w), Number(target.h)) / 2;
  const a = dx * dx + dy * dy;
  if (!(a > 0)) return null;
  const c = fx * fx + fy * fy - radius * radius;
  if (c <= 0) return { x: Number(start.x), y: Number(start.y), progress: 0 };
  const b = 2 * (fx * dx + fy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(value => value >= 0 && value <= 1);
  if (!candidates.length) return null;
  const progress = Math.min(...candidates);
  return { x: Number(start.x) + dx * progress, y: Number(start.y) + dy * progress, progress };
}

function impactFacing(rammerCenter, target) {
  const bearing = headingToPoint(target.center, rammerCenter);
  const relative = Math.abs(signedAngleDifference(bearing, Number(target.document.rotation ?? 0)));
  return relative <= 45 ? "front" : relative >= 135 ? "rear" : "side";
}

function criticalSummary(critical) {
  if (critical.escortDestroyed) return "Escort destroyed";
  return critical.results?.map(result => `${result.name}${result.extraDamage ? ` (+${result.extraDamage} damage)` : ""}`).join("; ") || "None";
}

function catastrophicSummary(catastrophic) {
  if (!catastrophic) return "None";
  return `${catastrophic.name}. ${catastrophic.instruction}`;
}

async function rollRamDamage(attacker, defender, dice, targetNumber, flavor) {
  const roll = await new Roll(`${dice}d6`).evaluate();
  await publishBFGDice(roll, { speaker: ChatMessage.getSpeaker({ token: attacker.document }), flavor });
  const results = diceFaces(roll);
  const hits = results.filter(value => value >= targetNumber).length;
  const brace = await rollBraceSaves(defender, hits, "Brace saves against ramming damage");
  const critical = await rollCriticalHits(defender, brace.unsaved);
  const before = getCombatState(defender);
  const remainingHull = critical.escortDestroyed ? 0 : Math.max(0, before.currentHits - brace.unsaved - critical.extraDamage);
  const catastrophic = !before.outOfAction && remainingHull <= 0 ? await rollCatastrophicDamage(defender) : null;
  return { dice, targetNumber, results, hits, brace, critical, remainingHull, catastrophic };
}

export async function resolveRamAtContact(rammer, target, contactPoint) {
  const rammerBefore = getCombatState(rammer);
  const targetBefore = getCombatState(target);
  if (!rammerBefore || !targetBefore) throw new Error("Both ramming participants must be configured ships.");
  const facing = impactFacing(contactPoint, target);
  const rammerDice = rammerBefore.maximumHits;
  const returnDice = facing === "front" || rammingSize(target) === "defence"
    ? targetBefore.maximumHits
    : Math.ceil(targetBefore.maximumHits / 2);
  const targetArmour = armourNumber(facing === "front" ? targetBefore.armourFront : targetBefore.armourOther);
  const rammerArmour = armourNumber(rammerBefore.armourFront);
  const targetAlreadyBraced = getSpecialOrder(target)?.id === "brace-for-impact";
  return openActionResolution({
    heading: `Ram: ${rammer.name} into ${target.name}`,
    rollLabel: "Roll ramming damage",
    applyLabel: "Apply ramming damage",
    detailsHtml: `<div class="bfg-action-confirmation"><div><span>Impact facing</span><strong>${facing}</strong></div><div><span>${rammer.name} attack dice</span><strong>${rammerDice}d6, needing ${targetArmour}+</strong></div><div><span>${target.name} return dice</span><strong>${returnDice}d6, needing ${rammerArmour}+</strong></div><div><span>Shields</span><strong>Ignored</strong></div><div><label><input type="checkbox" name="targetBrace" ${targetAlreadyBraced ? "checked disabled" : ""}> ${targetAlreadyBraced ? `${target.name} is already Braced for Impact` : `Attempt to Brace ${target.name} for Impact before rolling`}</label></div><div><label><input type="checkbox" name="targetBraceBlastContact" ${targetAlreadyBraced ? "disabled" : ""}> Target has Blast Markers in base contact (-1 Leadership)</label></div></div>`,
    readOptions: element => ({
      targetBrace: Boolean(element.querySelector('[name="targetBrace"]')?.checked),
      targetBraceBlastContact: Boolean(element.querySelector('[name="targetBraceBlastContact"]')?.checked)
    }),
    roll: async options => {
      let targetBraceStatus = targetAlreadyBraced ? "Already active" : "Not attempted";
      if (options.targetBrace && !targetAlreadyBraced) {
        const braced = await attemptBraceForImpact(target, { blastContact: options.targetBraceBlastContact });
        targetBraceStatus = braced ? "Command check passed" : "Command check failed";
      }
      const againstTarget = await rollRamDamage(rammer, target, rammerDice, targetArmour, `${rammer.name}: Ramming damage against ${target.name}`);
      const againstRammer = await rollRamDamage(target, rammer, returnDice, rammerArmour, `${target.name}: Return ramming damage against ${rammer.name}`);
      return {
        facing, againstTarget, againstRammer,
        resultHtml: `<h3>Ramming result</h3><div class="bfg-action-confirmation"><div><span>${target.name} Brace for Impact</span><strong>${targetBraceStatus}</strong></div><div><span>${rammer.name} dice (${rammerDice}d6, needing ${targetArmour}+)</span><strong>${againstTarget.results.join(", ") || "None"}</strong></div><div><span>Hits on ${target.name}</span><strong>${againstTarget.hits}</strong></div><div><span>${target.name} Brace saves</span><strong>${againstTarget.brace.dice.join(", ") || "None"}; saved ${againstTarget.brace.saved}</strong></div><div><span>${target.name} critical checks (${againstTarget.brace.unsaved}d6, needing 6)</span><strong>${againstTarget.critical.checkResults.join(", ") || "None"}</strong></div><div><span>${target.name} critical effects</span><strong>${foundry.utils.escapeHTML(criticalSummary(againstTarget.critical))}</strong></div><div><span>${target.name} catastrophic result</span><strong>${foundry.utils.escapeHTML(catastrophicSummary(againstTarget.catastrophic))}</strong></div><div><span>${target.name} remaining hull</span><strong>${againstTarget.remainingHull}</strong></div><div><span>${target.name} dice (${returnDice}d6, needing ${rammerArmour}+)</span><strong>${againstRammer.results.join(", ") || "None"}</strong></div><div><span>Hits on ${rammer.name}</span><strong>${againstRammer.hits}</strong></div><div><span>${rammer.name} Brace saves</span><strong>${againstRammer.brace.dice.join(", ") || "None"}; saved ${againstRammer.brace.saved}</strong></div><div><span>${rammer.name} critical checks (${againstRammer.brace.unsaved}d6, needing 6)</span><strong>${againstRammer.critical.checkResults.join(", ") || "None"}</strong></div><div><span>${rammer.name} critical effects</span><strong>${foundry.utils.escapeHTML(criticalSummary(againstRammer.critical))}</strong></div><div><span>${rammer.name} catastrophic result</span><strong>${foundry.utils.escapeHTML(catastrophicSummary(againstRammer.catastrophic))}</strong></div><div><span>${rammer.name} remaining hull</span><strong>${againstRammer.remainingHull}</strong></div></div><p>Review both ships' damage before applying it. Resolve any listed catastrophic explosion immediately.</p>`
      };
    },
    apply: async outcome => {
      if (getCombatState(rammer).currentHits !== rammerBefore.currentHits || getCombatState(target).currentHits !== targetBefore.currentHits) throw new Error("A ramming participant changed after the roll. Resolve the ram again.");
      await setCombatState(target, { currentHits: outcome.againstTarget.remainingHull, currentShields: targetBefore.currentShields });
      await setCombatState(rammer, { currentHits: outcome.againstRammer.remainingHull, currentShields: rammerBefore.currentShields });
      await setCriticalState(target, outcome.againstTarget.critical.after);
      await setCriticalState(rammer, outcome.againstRammer.critical.after);
      if (outcome.againstTarget.catastrophic) await setCatastrophicState(target, outcome.againstTarget.catastrophic);
      if (outcome.againstRammer.catastrophic) await setCatastrophicState(rammer, outcome.againstRammer.catastrophic);
      await ChatMessage.create({ content: `<strong>Ram resolved: ${foundry.utils.escapeHTML(rammer.name)} into ${foundry.utils.escapeHTML(target.name)}</strong><br>${foundry.utils.escapeHTML(target.name)} takes ${outcome.againstTarget.brace.unsaved} unsaved ramming damage plus ${outcome.againstTarget.critical.extraDamage} critical damage; ${outcome.againstTarget.remainingHull} hull remains.<br>${foundry.utils.escapeHTML(rammer.name)} takes ${outcome.againstRammer.brace.unsaved} unsaved return damage plus ${outcome.againstRammer.critical.extraDamage} critical damage; ${outcome.againstRammer.remainingHull} hull remains.` });
    }
  });
}
