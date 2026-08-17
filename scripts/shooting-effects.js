import { MODULE_ID } from "./constants.js";

export const SHOOTING_EFFECTS_ENABLED = "shootingEffectsEnabled";
export const SHOOTING_EFFECTS_SPEED = "shootingEffectsSpeed";

const activeEffects = new Set();
const PROJECTILE_CAP = 8;

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
  const length = 15;
  const width = 4.5;
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
  graphics.beginFill(colour, alpha);
  graphics.drawPolygon([...nose, ...left, ...tail, ...right]);
  graphics.endFill();
}

function drawImpact(graphics, centre, radius, colour, alpha, width = 3) {
  graphics.lineStyle(width, colour, alpha);
  graphics.drawCircle(centre.x, centre.y, radius);
  graphics.beginFill(colour, alpha * 0.35);
  graphics.drawCircle(centre.x, centre.y, Math.max(2, radius * 0.3));
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
    graphics.lineStyle(index % 2 ? 2 : 4, hit ? 0x33ccff : 0x2288ff, opacity);
    graphics.moveTo(attacker.center.x, attacker.center.y);
    graphics.lineTo(end.x, end.y);
    graphics.lineStyle(1, 0xccf6ff, opacity);
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
  const length = 28;
  const width = 7;
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
  graphics.beginFill(0xeafcff, alpha);
  graphics.drawPolygon([...nose, ...left, ...tail, ...right]);
  graphics.endFill();
  graphics.lineStyle(4, 0x55ccff, alpha * 0.7);
  graphics.moveTo(...tail);
  const trail = transform(-length * 1.3, 0);
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
          graphics.lineStyle(2, 0x99ddff, 0.55);
          graphics.moveTo(aim.x, aim.y);
          graphics.lineTo(point.x, point.y);
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

export async function playOrdnanceAttackAnimation({ attackers = [], target, outcome, kind = "attack-craft" } = {}) {
  if (!game.settings.get(MODULE_ID, SHOOTING_EFFECTS_ENABLED) || !canvas?.ready || !target || !attackers.length) return false;
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
          graphics.lineStyle(3, 0xffcc66, 0.8);
          graphics.moveTo(attackers[0].center.x, attackers[0].center.y);
          graphics.lineTo(first.x, first.y);
          graphics.lineStyle(3, 0x66ccff, 0.8);
          graphics.moveTo(target.center.x, target.center.y);
          graphics.lineTo(second.x, second.y);
          if (outcome?.removed) drawImpact(graphics, midpoint, 8 + Math.max(0, progress - 0.4) * 45, 0xff8844, Math.sin(Math.max(0, progress - 0.35) / 0.65 * Math.PI), 4);
        } else {
          const defenseProgress = Math.min(1, progress / 0.34);
          const defenseCount = Math.min(PROJECTILE_CAP, Math.max(turretKills + capKills, Number(outcome?.turretDice ?? outcome?.defensiveTurretDice ?? 0)));
          for (let index = 0; index < defenseCount; index += 1) {
            const craft = attackers[index % attackers.length];
            const end = pointAlong(target.center, craft.center, defenseProgress);
            graphics.lineStyle(2, index < capKills ? 0x55bbff : 0xff5555, 0.8);
            graphics.moveTo(target.center.x, target.center.y);
            graphics.lineTo(end.x, end.y);
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
                graphics.lineStyle(3, 0xffdd88, 0.85);
                graphics.moveTo(source.center.x, source.center.y);
                graphics.lineTo(point.x, point.y);
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

export async function playTorpedoReplayAnimation({ salvo, target, outcome, speedCm = 0 } = {}) {
  if (!game.settings.get(MODULE_ID, SHOOTING_EFFECTS_ENABLED) || !canvas?.ready || !salvo || !target) return false;
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
            graphics.lineStyle(2, 0xff5555, Math.sin(defense * Math.PI));
            graphics.moveTo(target.center.x - position.x, target.center.y - position.y);
            graphics.lineTo(spread, 0);
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

export function clearAllShootingEffects() {
  for (const effect of activeEffects) {
    if (effect.frame !== null) cancelAnimationFrame(effect.frame);
    effect.cleanup?.();
    if (!effect.graphics.destroyed) effect.graphics.destroy({ children: true });
    effect.resolve?.(false);
  }
  activeEffects.clear();
}
