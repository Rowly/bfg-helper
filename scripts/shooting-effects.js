import { MODULE_ID } from "./constants.js";

export const SHOOTING_EFFECTS_ENABLED = "shootingEffectsEnabled";
export const SHOOTING_EFFECTS_SPEED = "shootingEffectsSpeed";

const activeEffects = new Set();
const PROJECTILE_CAP = 8;
const EFFECT_SOCKET = `module.${MODULE_ID}`;
let socketInitialised = false;

function emitEffect(type, data) {
  game.socket?.emit(EFFECT_SOCKET, {
    event: "combat-animation",
    type,
    data,
    sceneId: canvas?.scene?.id ?? null,
    senderId: game.user?.id ?? null
  });
}

function directFirePayload(resolution) {
  return {
    attackerId: resolution?.attackerId,
    targetId: resolution?.targetId,
    weaponType: resolution?.weaponType,
    results: [...(resolution?.results ?? [])],
    hitTarget: resolution?.hitTarget,
    isOrdnance: Boolean(resolution?.isOrdnance),
    ordnanceHit: Boolean(resolution?.ordnanceHit),
    damage: {
      shieldHits: Number(resolution?.damage?.shieldHits ?? 0),
      hullHits: Number(resolution?.damage?.hullHits ?? 0),
      critical: { results: Array(Number(resolution?.damage?.critical?.results?.length ?? 0)).fill(true) }
    }
  };
}

function ordnancePayload(outcome) {
  return {
    shotDown: Number(outcome?.shotDown ?? 0),
    turretVictims: Array(Number(outcome?.turretVictims?.length ?? 0)).fill(true),
    intercepted: Array(Number(outcome?.intercepted?.length ?? 0)).fill(true),
    afterTurrets: Array(Number(outcome?.afterTurrets?.length ?? 0)).fill(true),
    attackingStrength: Number(outcome?.attackingStrength ?? 0),
    turretDice: Number(outcome?.turretDice ?? 0),
    defensiveTurretDice: Number(outcome?.defensiveTurretDice ?? 0),
    hits: Number(outcome?.hits ?? 0),
    brace: { unsaved: Number(outcome?.brace?.unsaved ?? 0) },
    critical: { results: Array(Number(outcome?.critical?.results?.length ?? 0)).fill(true) },
    pendingHitAndRun: Number(outcome?.pendingHitAndRun ?? 0),
    removed: Boolean(outcome?.removed),
    catastrophic: Boolean(outcome?.catastrophic)
  };
}

export function initialiseShootingEffectSocket() {
  if (socketInitialised) return;
  socketInitialised = true;
  game.socket.on(EFFECT_SOCKET, message => {
    if (message?.event !== "combat-animation" || message.senderId === game.user?.id) return;
    if (!canvas?.ready || message.sceneId !== canvas.scene?.id) return;
    const data = message.data ?? {};
    if (message.type === "direct-fire") void playDirectFireAnimation({ ...data, remote: true });
    else if (message.type === "nova-cannon") void playNovaCannonAnimation({ ...data, remote: true });
    else if (message.type === "ordnance") {
      const attackers = (data.attackerIds ?? []).map(id => canvas.tokens?.get(id)).filter(Boolean);
      const target = canvas.tokens?.get(data.targetId);
      void playOrdnanceAttackAnimation({ attackers, target, outcome: data.outcome, kind: data.kind, remote: true });
    } else if (message.type === "torpedo") {
      const salvo = canvas.tokens?.get(data.salvoId);
      const target = canvas.tokens?.get(data.targetId);
      void playTorpedoReplayAnimation({ salvo, target, outcome: data.outcome, speedCm: data.speedCm, remote: true });
    } else if (message.type === "ramming") {
      const rammer = canvas.tokens?.get(data.rammerId);
      const target = canvas.tokens?.get(data.targetId);
      void playRammingAnimation({ rammer, target, outcome: data.outcome, remote: true });
    }
  });
}

export function registerShootingEffectSettings() {
  game.settings.register(MODULE_ID, SHOOTING_EFFECTS_ENABLED, {
    name: "Enable combat animations",
    hint: "Show temporary direct-fire, Nova Cannon, ordnance, shield and hull-impact effects on the canvas.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SHOOTING_EFFECTS_SPEED, {
    name: "Combat animation duration",
    hint: "Use shorter combat effects while retaining the same resolved dice and damage.",
    scope: "client",
    config: true,
    type: String,
    choices: { normal: "Normal", reduced: "Reduced" },
    default: "normal"
  });
}

function animationDuration(type) {
  const reduced = game.settings.get(MODULE_ID, SHOOTING_EFFECTS_SPEED) === "reduced";
  const normal = type === "lance" ? 900 : type === "nova-cannon" ? 1450 : 1150;
  return reduced ? Math.round(normal * 0.55) : normal;
}

function pointAlong(start, end, progress) {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress
  };
}

function offsetPoint(point, perpendicular, amount) {
  return { x: point.x + perpendicular.x * amount, y: point.y + perpendicular.y * amount };
}

const EFFECT_SIZE = 1.65;
const EFFECT_OUTLINE = 0x071018;

function drawContrastingLine(graphics, start, end, colour, alpha, width) {
  graphics.lineStyle(width + 5, EFFECT_OUTLINE, alpha * 0.8);
  graphics.moveTo(start.x, start.y);
  graphics.lineTo(end.x, end.y);
  graphics.lineStyle(width, colour, alpha);
  graphics.moveTo(start.x, start.y);
  graphics.lineTo(end.x, end.y);
}

function projectileDestination(start, target, index, hit) {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const perpendicular = { x: -dy / length, y: dx / length };
  const spread = ((index % 5) - 2) * 9;
  if (hit) return offsetPoint(target, perpendicular, spread * 0.45);
  const overshoot = 1.12 + (index % 3) * 0.07;
  return offsetPoint({ x: start.x + dx * overshoot, y: start.y + dy * overshoot }, perpendicular, spread * 2.6);
}

function drawTeardrop(graphics, point, angle, colour, alpha) {
  const length = 15 * EFFECT_SIZE;
  const width = 4.5 * EFFECT_SIZE;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const transform = (forward, side) => [
    point.x + cos * forward - sin * side,
    point.y + sin * forward + cos * side
  ];
  const nose = transform(length * 0.55, 0);
  const left = transform(-length * 0.45, width);
  const tail = transform(-length * 0.75, 0);
  const right = transform(-length * 0.45, -width);
  graphics.lineStyle(3, EFFECT_OUTLINE, alpha * 0.9);
  graphics.beginFill(colour, alpha);
  graphics.drawPolygon([...nose, ...left, ...tail, ...right]);
  graphics.endFill();
}

function drawImpact(graphics, centre, radius, colour, alpha, width = 3) {
  const visibleRadius = radius * 1.4;
  graphics.lineStyle(width + 5, EFFECT_OUTLINE, alpha * 0.72);
  graphics.drawCircle(centre.x, centre.y, visibleRadius);
  graphics.lineStyle(width + 2, colour, alpha);
  graphics.drawCircle(centre.x, centre.y, visibleRadius);
  graphics.beginFill(colour, alpha * 0.35);
  graphics.drawCircle(centre.x, centre.y, Math.max(4, visibleRadius * 0.34));
  graphics.endFill();
}

function impactCounts(resolution) {
  if (resolution.isOrdnance) {
    return { shield: 0, hull: resolution.ordnanceHit ? 1 : 0, critical: 0 };
  }
  return {
    shield: Math.max(0, Number(resolution.damage?.shieldHits ?? 0)),
    hull: Math.max(0, Number(resolution.damage?.hullHits ?? 0)),
    critical: Math.max(0, Number(resolution.damage?.critical?.results?.length ?? 0))
  };
}

function drawImpacts(graphics, target, progress, counts) {
  if (progress <= 0) return;
  const pulse = Math.sin(Math.min(1, progress) * Math.PI);
  const alpha = Math.max(0, pulse);
  if (counts.shield > 0) {
    const radius = Math.max(18, Math.min(target.w, target.h) * 0.55) * (0.75 + progress * 0.55);
    drawImpact(graphics, target.center, radius, 0x66ddff, alpha, 4);
  }
  if (counts.hull > 0) {
    const flashes = Math.min(4, counts.hull);
    for (let index = 0; index < flashes; index += 1) {
      const angle = index * 2.4 + 0.5;
      const distance = 5 + (index % 2) * 10;
      const centre = {
        x: target.center.x + Math.cos(angle) * distance,
        y: target.center.y + Math.sin(angle) * distance
      };
      drawImpact(graphics, centre, 8 + progress * 15 + index * 2, index % 2 ? 0xff8a33 : 0xffe0a3, alpha, 3);
    }
  }
  if (counts.critical > 0) {
    drawImpact(graphics, target.center, 22 + progress * 30, 0xff4422, alpha, 5);
  }
}

function drawLances(graphics, attacker, target, resolution, progress, counts) {
  const results = resolution.results ?? [];
  const visualCount = Math.min(PROJECTILE_CAP, Math.max(1, results.length));
  const travel = Math.min(1, progress / 0.58);
  for (let index = 0; index < visualCount; index += 1) {
    const hit = Number(results[index] ?? 0) >= Number(resolution.hitTarget ?? 4);
    const destination = projectileDestination(attacker.center, target.center, index, hit);
    const end = pointAlong(attacker.center, destination, travel);
    const opacity = 0.35 + 0.55 * Math.sin(Math.min(1, travel) * Math.PI * 0.75);
    drawContrastingLine(graphics, attacker.center, end, hit ? 0x28bfff : 0x167ddd, opacity, index % 2 ? 6 : 9);
    graphics.lineStyle(2.5, 0xe8fbff, opacity);
    graphics.moveTo(attacker.center.x, attacker.center.y);
    graphics.lineTo(end.x, end.y);
  }
  drawImpacts(graphics, target, Math.max(0, (progress - 0.48) / 0.52), counts);
}

function drawBattery(graphics, attacker, target, resolution, progress, counts) {
  const results = resolution.results ?? [];
  const visualCount = Math.min(PROJECTILE_CAP, Math.max(1, results.length));
  const travel = Math.min(1, progress / 0.72);
  for (let index = 0; index < visualCount; index += 1) {
    const hit = Number(results[index] ?? 0) >= Number(resolution.hitTarget ?? 6);
    const destination = projectileDestination(attacker.center, target.center, index, hit);
    const staggered = Math.max(0, Math.min(1, travel * 1.25 - index * 0.045));
    const point = pointAlong(attacker.center, destination, staggered);
    const angle = Math.atan2(destination.y - attacker.center.y, destination.x - attacker.center.x);
    drawTeardrop(graphics, point, angle + Math.PI, hit ? 0xffdf7a : 0xffaa55, 0.9);
  }
  drawImpacts(graphics, target, Math.max(0, (progress - 0.58) / 0.42), counts);
}

export async function playDirectFireAnimation(resolution) {
  if (!game.settings.get(MODULE_ID, SHOOTING_EFFECTS_ENABLED) || !canvas?.ready) return false;
  const attacker = canvas.tokens?.get(resolution?.attackerId);
  const target = canvas.tokens?.get(resolution?.targetId);
  if (!attacker || !target) return false;
  const type = String(resolution.weaponType ?? "").toLowerCase();
  if (!['lance', 'battery'].includes(type)) return false;
  if (!(resolution.results?.length > 0)) return false;
  if (!resolution.remote) emitEffect("direct-fire", directFirePayload(resolution));

  const graphics = new PIXI.Graphics();
  graphics.name = `bfg-shooting-effect-${foundry.utils.randomID()}`;
  graphics.eventMode = "none";
  canvas.tokens.addChild(graphics);
  const duration = animationDuration(type);
  const counts = impactCounts(resolution);

  return new Promise(resolve => {
    const effect = { graphics, frame: null, resolve };
    activeEffects.add(effect);
    const started = performance.now();
    const finish = result => {
      if (effect.frame !== null) cancelAnimationFrame(effect.frame);
      if (!graphics.destroyed) graphics.destroy({ children: true });
      activeEffects.delete(effect);
      resolve(result);
    };
    const frame = now => {
      try {
        if (graphics.destroyed || !canvas?.ready) {
          finish(false);
          return;
        }
        const progress = Math.min(1, (now - started) / duration);
        graphics.clear();
        if (type === "lance") drawLances(graphics, attacker, target, resolution, progress, counts);
        else drawBattery(graphics, attacker, target, resolution, progress, counts);
        if (progress < 1) {
          effect.frame = requestAnimationFrame(frame);
          return;
        }
        finish(true);
      } catch (error) {
        console.error("BFG Helper | Shooting animation failed", error);
        finish(false);
      }
    };
    effect.frame = requestAnimationFrame(frame);
  });
}

function novaScale() {
  const size = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  return size > 0 && distance > 0 ? size / distance : 20;
}

function drawNovaShell(graphics, point, angle, alpha) {
  const length = 28 * 1.5;
  const width = 7 * 1.5;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const transform = (forward, side) => [
    point.x + cos * forward - sin * side,
    point.y + sin * forward + cos * side
  ];
  const nose = transform(length * 0.6, 0);
  const left = transform(-length * 0.25, width);
  const tail = transform(-length * 0.6, 0);
  const right = transform(-length * 0.25, -width);
  graphics.lineStyle(4, EFFECT_OUTLINE, alpha * 0.9);
  graphics.beginFill(0xeafcff, alpha);
  graphics.drawPolygon([...nose, ...left, ...tail, ...right]);
  graphics.endFill();
  graphics.lineStyle(7, EFFECT_OUTLINE, alpha * 0.7);
  graphics.moveTo(...tail);
  const trail = transform(-length * 1.3, 0);
  graphics.lineTo(...trail);
  graphics.lineStyle(4, 0x55ccff, alpha * 0.95);
  graphics.moveTo(...tail);
  graphics.lineTo(...trail);
}

function drawNovaDetonation(graphics, point, progress, contacted) {
  if (progress <= 0) return;
  const scale = novaScale();
  const templateRadius = 2.5 * scale;
  const firstHalf = Math.min(1, progress * 2);
  const secondHalf = Math.max(0, progress * 2 - 1);
  const flashAlpha = Math.sin(Math.min(1, progress) * Math.PI);
  const contraction = templateRadius * (1.3 - firstHalf * 1.12);
  graphics.lineStyle(Math.max(4, scale * 0.12), 0x99eeff, 0.9 * (1 - secondHalf));
  graphics.drawCircle(point.x, point.y, Math.max(scale * 0.18, contraction));
  graphics.beginFill(0xffffff, 0.72 * flashAlpha);
  graphics.drawCircle(point.x, point.y, Math.max(scale * 0.15, templateRadius * 0.22 * (1 - firstHalf * 0.7)));
  graphics.endFill();
  if (secondHalf > 0) {
    graphics.lineStyle(Math.max(3, scale * 0.09), 0x6699ff, 0.8 * (1 - secondHalf));
    graphics.drawCircle(point.x, point.y, templateRadius * (0.2 + secondHalf * 0.95));
    graphics.beginFill(0x5533aa, 0.28 * (1 - secondHalf));
    graphics.drawCircle(point.x, point.y, templateRadius * (0.15 + secondHalf * 0.85));
    graphics.endFill();
  }
  for (let index = 0; index < Math.min(4, contacted); index += 1) {
    const angle = index * 2.2 + progress * 0.8;
    const radius = templateRadius * (0.25 + secondHalf * 0.7);
    const centre = { x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius };
    drawImpact(graphics, centre, 5 + secondHalf * 16, 0xffaa55, flashAlpha, 2);
  }
}

export async function playNovaCannonAnimation(outcome) {
  if (!game.settings.get(MODULE_ID, SHOOTING_EFFECTS_ENABLED) || !canvas?.ready) return false;
  const attacker = canvas.tokens?.get(outcome?.attackerId);
  const aim = outcome?.aimPoint;
  const final = outcome?.finalPoint;
  if (!attacker || !aim || !final) return false;
  if (!outcome.remote) emitEffect("nova-cannon", {
    attackerId: outcome.attackerId,
    aimPoint: outcome.aimPoint,
    finalPoint: outcome.finalPoint,
    directHit: Boolean(outcome.directHit),
    shipResults: Array(Number(outcome.shipResults?.length ?? 0)).fill(true),
    ordnanceIds: [...(outcome.ordnanceIds ?? [])]
  });

  const graphics = new PIXI.Graphics();
  graphics.name = `bfg-nova-effect-${foundry.utils.randomID()}`;
  graphics.eventMode = "none";
  canvas.tokens.addChild(graphics);
  const duration = animationDuration("nova-cannon");
  const contacted = Number(outcome.shipResults?.length ?? 0) + Number(outcome.ordnanceIds?.length ?? 0);

  return new Promise(resolve => {
    const effect = { graphics, frame: null, resolve };
    activeEffects.add(effect);
    const started = performance.now();
    const finish = result => {
      if (effect.frame !== null) cancelAnimationFrame(effect.frame);
      if (!graphics.destroyed) graphics.destroy({ children: true });
      activeEffects.delete(effect);
      resolve(result);
    };
    const frame = now => {
      try {
        if (graphics.destroyed || !canvas?.ready) return finish(false);
        const progress = Math.min(1, (now - started) / duration);
        graphics.clear();
        if (progress < 0.52) {
          const travel = progress / 0.52;
          const point = pointAlong(attacker.center, aim, travel);
          const angle = Math.atan2(aim.y - attacker.center.y, aim.x - attacker.center.x);
          drawNovaShell(graphics, point, angle, 0.75 + travel * 0.25);
        } else if (progress < 0.68 && !outcome.directHit) {
          const travel = (progress - 0.52) / 0.16;
          const point = pointAlong(aim, final, travel);
          const angle = Math.atan2(final.y - aim.y, final.x - aim.x);
          drawNovaShell(graphics, point, angle, 1);
          drawContrastingLine(graphics, aim, point, 0x99ddff, 0.7, 4);
        }
        const detonationStart = outcome.directHit ? 0.52 : 0.64;
        drawNovaDetonation(graphics, final, Math.max(0, (progress - detonationStart) / (1 - detonationStart)), contacted);
        if (progress < 1) {
          effect.frame = requestAnimationFrame(frame);
          return;
        }
        finish(true);
      } catch (error) {
        console.error("BFG Helper | Nova Cannon animation failed", error);
        finish(false);
      }
    };
    effect.frame = requestAnimationFrame(frame);
  });
}

function ordnanceImpactCounts(outcome) {
  return {
    shield: 0,
    hull: Math.max(0, Number(outcome?.brace?.unsaved ?? outcome?.hits ?? 0)),
    critical: Math.max(0, Number(outcome?.critical?.results?.length ?? 0))
  };
}

export async function playOrdnanceAttackAnimation({ attackers = [], target, outcome, kind = "attack-craft", remote = false } = {}) {
  if (!game.settings.get(MODULE_ID, SHOOTING_EFFECTS_ENABLED) || !canvas?.ready || !target || !attackers.length) return false;
  if (!remote) emitEffect("ordnance", {
    attackerIds: attackers.map(attacker => attacker.id),
    targetId: target.id,
    outcome: ordnancePayload(outcome),
    kind
  });
  const graphics = new PIXI.Graphics();
  graphics.name = `bfg-ordnance-effect-${foundry.utils.randomID()}`;
  graphics.eventMode = "none";
  canvas.tokens.addChild(graphics);
  const reduced = game.settings.get(MODULE_ID, SHOOTING_EFFECTS_SPEED) === "reduced";
  const duration = reduced ? 720 : 1300;
  const turretKills = Math.max(0, Number(outcome?.shotDown ?? outcome?.turretVictims?.length ?? 0));
  const capKills = Math.max(0, Number(outcome?.intercepted?.length ?? 0));
  const attackingCount = kind === "torpedo"
    ? Math.max(0, Number(outcome?.attackingStrength ?? 0))
    : Math.max(0, Number(outcome?.afterTurrets?.length ?? attackers.length));
  const counts = ordnanceImpactCounts(outcome);

  return new Promise(resolve => {
    const effect = { graphics, frame: null, resolve };
    activeEffects.add(effect);
    const started = performance.now();
    const finish = result => {
      if (effect.frame !== null) cancelAnimationFrame(effect.frame);
      if (!graphics.destroyed) graphics.destroy({ children: true });
      activeEffects.delete(effect);
      resolve(result);
    };
    const frame = now => {
      try {
        if (graphics.destroyed || !canvas?.ready) return finish(false);
        const progress = Math.min(1, (now - started) / duration);
        graphics.clear();

        if (kind === "interception") {
          const midpoint = pointAlong(attackers[0].center, target.center, 0.5);
          const approach = Math.min(1, progress / 0.5);
          const first = pointAlong(attackers[0].center, midpoint, approach);
          const second = pointAlong(target.center, midpoint, approach);
          drawContrastingLine(graphics, attackers[0].center, first, 0xffcc66, 0.9, 6);
          drawContrastingLine(graphics, target.center, second, 0x66ccff, 0.9, 6);
          if (outcome?.removed) drawImpact(graphics, midpoint, 8 + Math.max(0, progress - 0.4) * 45, 0xff8844, Math.sin(Math.max(0, progress - 0.35) / 0.65 * Math.PI), 4);
        } else {
          const defenseProgress = Math.min(1, progress / 0.34);
          const defenseCount = Math.min(PROJECTILE_CAP, Math.max(turretKills + capKills, Number(outcome?.turretDice ?? outcome?.defensiveTurretDice ?? 0)));
          for (let index = 0; index < defenseCount; index += 1) {
            const craft = attackers[index % attackers.length];
            const end = pointAlong(target.center, craft.center, defenseProgress);
            drawContrastingLine(graphics, target.center, end, index < capKills ? 0x55bbff : 0xff5555, 0.9, 5);
            if (index < turretKills + capKills && progress > 0.22) drawImpact(graphics, craft.center, 5 + (progress - 0.22) * 18, 0xff8844, Math.max(0, 1 - progress), 2);
          }

          if (progress >= 0.28) {
            const attackProgress = Math.min(1, (progress - 0.28) / 0.48);
            const visualAttacks = Math.min(PROJECTILE_CAP, Math.max(0, attackingCount));
            for (let index = 0; index < visualAttacks; index += 1) {
              const source = attackers[index % attackers.length];
              const destination = projectileDestination(source.center, target.center, index, index < Number(outcome?.hits ?? 0));
              const point = pointAlong(source.center, destination, Math.max(0, Math.min(1, attackProgress * 1.2 - index * 0.035)));
              const angle = Math.atan2(destination.y - source.center.y, destination.x - source.center.x);
              if (kind === "torpedo") drawTeardrop(graphics, point, angle + Math.PI, 0xffaa55, 0.95);
              else {
                drawContrastingLine(graphics, source.center, point, 0xffdd88, 0.92, 6);
              }
            }
          }
          drawImpacts(graphics, target, Math.max(0, (progress - 0.65) / 0.35), counts);
          if (Number(outcome?.pendingHitAndRun ?? 0) > 0 && progress > 0.72) {
            const pulse = Math.sin((progress - 0.72) / 0.28 * Math.PI);
            drawImpact(graphics, target.center, Math.max(12, Math.min(target.w, target.h) * 0.32), 0xaaff66, pulse, 3);
          }
        }

        if (progress < 1) {
          effect.frame = requestAnimationFrame(frame);
          return;
        }
        finish(true);
      } catch (error) {
        console.error("BFG Helper | Ordnance animation failed", error);
        finish(false);
      }
    };
    effect.frame = requestAnimationFrame(frame);
  });
}

function firstContactProgress(start, end, target, salvo) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - target.center.x;
  const fy = start.y - target.center.y;
  const radius = Math.min(salvo.w, salvo.h) / 2 + Math.min(target.w, target.h) / 2;
  const a = dx * dx + dy * dy;
  if (!(a > 0)) return 0.5;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant >= 0) {
    const roots = [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)]
      .filter(value => value >= 0 && value <= 1);
    if (roots.length) return Math.min(...roots);
  }
  return Math.max(0, Math.min(1, -((start.x - target.center.x) * dx + (start.y - target.center.y) * dy) / a));
}

export async function playTorpedoReplayAnimation({ salvo, target, outcome, speedCm = 0, remote = false } = {}) {
  if (!game.settings.get(MODULE_ID, SHOOTING_EFFECTS_ENABLED) || !canvas?.ready || !salvo || !target) return false;
  if (!remote) emitEffect("torpedo", {
    salvoId: salvo.id,
    targetId: target.id,
    outcome: ordnancePayload(outcome),
    speedCm: Number(speedCm)
  });
  speedCm = Math.max(0, Number(speedCm));
  const scale = novaScale();
  const radians = Number(salvo.document.rotation ?? 0) * Math.PI / 180;
  const end = { x: Number(salvo.center.x), y: Number(salvo.center.y) };
  const distance = speedCm * scale;
  const start = {
    x: end.x - Math.sin(radians) * distance,
    y: end.y + Math.cos(radians) * distance
  };
  const contact = pointAlong(start, end, firstContactProgress(start, end, target, salvo));

  const container = new PIXI.Container();
  container.name = `bfg-torpedo-replay-${foundry.utils.randomID()}`;
  container.eventMode = "none";
  const sprite = PIXI.Sprite.from(String(salvo.document.texture?.src ?? ""));
  sprite.anchor.set(0.5);
  sprite.width = salvo.w;
  sprite.height = salvo.h;
  sprite.rotation = radians;
  const graphics = new PIXI.Graphics();
  container.addChild(sprite, graphics);
  canvas.tokens.addChild(container);
  const originalVisibility = salvo.visible;
  salvo.visible = false;
  const reduced = game.settings.get(MODULE_ID, SHOOTING_EFFECTS_SPEED) === "reduced";
  const duration = reduced ? 900 : 1650;

  return new Promise(resolve => {
    const restore = () => { if (!salvo.destroyed) salvo.visible = originalVisibility; };
    const effect = { graphics: container, frame: null, resolve, cleanup: restore };
    activeEffects.add(effect);
    const started = performance.now();
    const finish = result => {
      if (effect.frame !== null) cancelAnimationFrame(effect.frame);
      restore();
      if (!container.destroyed) container.destroy({ children: true });
      activeEffects.delete(effect);
      resolve(result);
    };
    const frame = now => {
      try {
        if (container.destroyed || !canvas?.ready) return finish(false);
        const progress = Math.min(1, (now - started) / duration);
        graphics.clear();
        let position;
        if (progress < 0.38) position = pointAlong(start, contact, progress / 0.38);
        else if (progress < 0.72) position = contact;
        else position = pointAlong(contact, end, (progress - 0.72) / 0.28);
        container.position.set(position.x, position.y);

        if (progress >= 0.38 && progress < 0.56) {
          const defense = (progress - 0.38) / 0.18;
          const turretCount = Math.min(PROJECTILE_CAP, Math.max(0, Number(outcome?.turretDice ?? 0)));
          for (let index = 0; index < turretCount; index += 1) {
            const spread = (index - (turretCount - 1) / 2) * 7;
            drawContrastingLine(
              graphics,
              { x: target.center.x - position.x, y: target.center.y - position.y },
              { x: spread, y: 0 },
              0xff5555,
              Math.sin(defense * Math.PI),
              5
            );
          }
          for (let index = 0; index < Math.min(PROJECTILE_CAP, Number(outcome?.shotDown ?? 0)); index += 1) {
            drawImpact(graphics, { x: (index - 2) * 8, y: (index % 2 ? 7 : -7) }, 5 + defense * 13, 0xff8844, Math.sin(defense * Math.PI), 2);
          }
        }

        if (progress >= 0.54 && progress < 0.75) {
          const attack = (progress - 0.54) / 0.21;
          const hitCount = Math.min(PROJECTILE_CAP, Math.max(0, Number(outcome?.hits ?? 0)));
          for (let index = 0; index < hitCount; index += 1) {
            const angle = index * 2.3;
            const centre = {
              x: target.center.x - position.x + Math.cos(angle) * (5 + index * 2),
              y: target.center.y - position.y + Math.sin(angle) * (5 + index * 2)
            };
            drawImpact(graphics, centre, 7 + attack * 18, 0xffaa55, Math.sin(Math.min(1, attack) * Math.PI), 3);
          }
        }

        if (progress < 1) {
          effect.frame = requestAnimationFrame(frame);
          return;
        }
        finish(true);
      } catch (error) {
        console.error("BFG Helper | Torpedo replay animation failed", error);
        finish(false);
      }
    };
    effect.frame = requestAnimationFrame(frame);
  });
}

export async function playRammingAnimation({ rammer, target, outcome, remote = false } = {}) {
  if (!game.settings.get(MODULE_ID, SHOOTING_EFFECTS_ENABLED) || !canvas?.ready || !rammer || !target) return false;
  if (!remote) emitEffect("ramming", {
    rammerId: rammer.id,
    targetId: target.id,
    outcome: {
      againstTarget: ordnancePayload(outcome?.againstTarget),
      againstRammer: ordnancePayload(outcome?.againstRammer)
    }
  });
  const graphics = new PIXI.Graphics();
  graphics.name = `bfg-ramming-effect-${foundry.utils.randomID()}`;
  graphics.eventMode = "none";
  canvas.tokens.addChild(graphics);
  const reduced = game.settings.get(MODULE_ID, SHOOTING_EFFECTS_SPEED) === "reduced";
  const duration = reduced ? 760 : 1400;
  const impact = pointAlong(rammer.center, target.center, 0.5);
  const dx = target.center.x - rammer.center.x;
  const dy = target.center.y - rammer.center.y;
  const length = Math.hypot(dx, dy) || 1;
  const direction = { x: dx / length, y: dy / length };
  const perpendicular = { x: -direction.y, y: direction.x };
  const targetDamage = Math.max(0, Number(outcome?.againstTarget?.brace?.unsaved ?? 0));
  const rammerDamage = Math.max(0, Number(outcome?.againstRammer?.brace?.unsaved ?? 0));
  const targetCritical = Math.max(0, Number(outcome?.againstTarget?.critical?.results?.length ?? 0));
  const rammerCritical = Math.max(0, Number(outcome?.againstRammer?.critical?.results?.length ?? 0));
  const catastrophic = Boolean(outcome?.againstTarget?.catastrophic || outcome?.againstRammer?.catastrophic);

  return new Promise(resolve => {
    const effect = { graphics, frame: null, resolve };
    activeEffects.add(effect);
    const started = performance.now();
    const finish = result => {
      if (effect.frame !== null) cancelAnimationFrame(effect.frame);
      if (!graphics.destroyed) graphics.destroy({ children: true });
      activeEffects.delete(effect);
      resolve(result);
    };
    const frame = now => {
      try {
        if (graphics.destroyed || !canvas?.ready) return finish(false);
        const progress = Math.min(1, (now - started) / duration);
        graphics.clear();

        if (progress < 0.38) {
          const strike = Math.min(1, progress / 0.24);
          const trailStart = {
            x: rammer.center.x - direction.x * Math.max(rammer.w, rammer.h) * 0.55,
            y: rammer.center.y - direction.y * Math.max(rammer.w, rammer.h) * 0.55
          };
          const trailEnd = pointAlong(trailStart, impact, strike);
          graphics.lineStyle(8, 0xffcc66, 0.25 + strike * 0.6);
          graphics.moveTo(trailStart.x, trailStart.y);
          graphics.lineTo(trailEnd.x, trailEnd.y);
          graphics.lineStyle(3, 0xffffff, 0.85);
          graphics.moveTo(trailStart.x, trailStart.y);
          graphics.lineTo(trailEnd.x, trailEnd.y);
        }

        if (progress >= 0.16) {
          const shock = Math.min(1, (progress - 0.16) / 0.55);
          const alpha = Math.sin(shock * Math.PI);
          graphics.lineStyle(6, catastrophic ? 0xff4433 : 0xffdd88, alpha);
          graphics.drawCircle(impact.x, impact.y, 10 + shock * Math.max(target.w, target.h) * 0.85);
          graphics.beginFill(0xffffff, alpha * 0.55);
          graphics.drawCircle(impact.x, impact.y, Math.max(3, 20 * (1 - shock)));
          graphics.endFill();
          for (let index = 0; index < 8; index += 1) {
            const side = (index - 3.5) * 8;
            const travel = 12 + shock * (35 + index * 4);
            const start = offsetPoint(impact, perpendicular, side);
            graphics.lineStyle(index % 2 ? 2 : 3, index % 2 ? 0xff8833 : 0xffe0a3, alpha);
            graphics.moveTo(start.x, start.y);
            graphics.lineTo(start.x + direction.x * travel, start.y + direction.y * travel);
          }
        }

        if (progress >= 0.48) {
          const damageProgress = Math.min(1, (progress - 0.48) / 0.52);
          drawImpacts(graphics, target, damageProgress, { shield: 0, hull: targetDamage, critical: targetCritical });
          drawImpacts(graphics, rammer, damageProgress, { shield: 0, hull: rammerDamage, critical: rammerCritical });
          if (catastrophic) drawImpact(graphics, impact, 28 + damageProgress * 75, 0xff3322, Math.sin(damageProgress * Math.PI), 6);
        }

        if (progress < 1) {
          effect.frame = requestAnimationFrame(frame);
          return;
        }
        finish(true);
      } catch (error) {
        console.error("BFG Helper | Ramming animation failed", error);
        finish(false);
      }
    };
    effect.frame = requestAnimationFrame(frame);
  });
}

export function clearAllShootingEffects() {
  for (const effect of activeEffects) {
    if (effect.frame !== null) cancelAnimationFrame(effect.frame);
    effect.cleanup?.();
    if (!effect.graphics.destroyed) effect.graphics.destroy({ children: true });
    effect.resolve?.(false);
  }
  activeEffects.clear();
}
