import { ENGINE_PREFIX } from "./constants.js";
import { getShipData } from "./ship-data.js";

const engines = new Map();
let ticker = null;

function pixelsPerCm() {
  const size = Number(canvas.scene?.grid?.size);
  const distance = Number(canvas.scene?.grid?.distance);
  if (!(size > 0) || !(distance > 0)) return null;
  return size / distance;
}

function keyFor(token) {
  return `${canvas.scene.id}.${token.id}`;
}

export function removeEngine(tokenOrDocument) {
  const tokenId = tokenOrDocument.id;
  const sceneId = tokenOrDocument.document ? canvas.scene.id : tokenOrDocument.parent?.id;
  const key = `${sceneId}.${tokenId}`;
  const entry = engines.get(key);
  if (entry?.graphics && !entry.graphics.destroyed) entry.graphics.destroy({ children: true });
  engines.delete(key);
}

export function createEngine(token) {
  removeEngine(token);
  const data = getShipData(token.actor);
  const engine = data?.engine;
  if (!engine?.enabled) return null;

  const scale = pixelsPerCm();
  if (!scale) return null;

  const separation = Number(engine.separationCm) * scale;
  const width = Number(engine.widthCm) * scale;
  const length = Number(engine.lengthCm) * scale;
  const stern = Number(engine.sternOffsetCm) * scale;
  const graphics = new PIXI.Graphics();
  graphics.name = `${ENGINE_PREFIX}${token.id}`;

  const drawPlume = (x) => {
    const outerHalf = width / 2;
    const innerHalf = width * 0.24;
    graphics.beginFill(Number(engine.outerColour ?? 0x3399ff), Number(engine.outerOpacity ?? 0.18));
    graphics.drawPolygon([x - outerHalf, stern, x + outerHalf, stern, x + outerHalf * 0.2, stern + length, x - outerHalf * 0.2, stern + length]);
    graphics.endFill();
    graphics.beginFill(Number(engine.innerColour ?? 0xccffff), Number(engine.innerOpacity ?? 0.48));
    graphics.drawPolygon([x - innerHalf, stern, x + innerHalf, stern, x + innerHalf * 0.15, stern + length * 0.7, x - innerHalf * 0.15, stern + length * 0.7]);
    graphics.endFill();
    graphics.beginFill(Number(engine.innerColour ?? 0xccffff), Math.min(Number(engine.innerOpacity ?? 0.48) + 0.2, 1));
    graphics.drawEllipse(x, stern, width * 0.34, width * 0.2);
    graphics.endFill();
  };

  drawPlume(-separation / 2);
  drawPlume(separation / 2);
  graphics.position.set(token.center.x, token.center.y);
  graphics.rotation = Number(token.document.rotation) * Math.PI / 180;
  canvas.tokens.addChildAt(graphics, 0);
  engines.set(keyFor(token), { graphics, tokenId: token.id, sceneId: canvas.scene.id });
  return graphics;
}

export function refreshEngines() {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens.placeables) {
    const data = getShipData(token.actor);
    if (data?.engine?.enabled) createEngine(token);
  }
}

export function initialiseEngineTicker() {
  if (ticker) canvas.app.ticker.remove(ticker);
  ticker = () => {
    for (const [key, entry] of engines.entries()) {
      if (entry.sceneId !== canvas.scene?.id || entry.graphics.destroyed) {
        engines.delete(key);
        continue;
      }
      const token = canvas.tokens.get(entry.tokenId);
      if (!token) {
        if (!entry.graphics.destroyed) entry.graphics.destroy({ children: true });
        engines.delete(key);
        continue;
      }
      entry.graphics.position.set(token.center.x, token.center.y);
      const renderedRotation = Number(token.mesh?.rotation);
      entry.graphics.rotation = Number.isFinite(renderedRotation)
        ? renderedRotation
        : Number(token.document.rotation) * Math.PI / 180;
    }
  };
  canvas.app.ticker.add(ticker);
}

export function clearAllEngines() {
  for (const entry of engines.values()) {
    if (!entry.graphics.destroyed) entry.graphics.destroy({ children: true });
  }
  engines.clear();
}
