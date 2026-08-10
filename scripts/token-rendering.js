/** Return the token's currently rendered rotation, including canvas animation. */
export function getRenderedTokenRotationRadians(token) {
  const renderedRotation = Number(token?.mesh?.rotation);
  return Number.isFinite(renderedRotation)
    ? renderedRotation
    : Number(token?.document?.rotation ?? 0) * Math.PI / 180;
}

/** Keep a token-centred PIXI overlay aligned with the rendered token. */
export function applyTokenOverlayTransform(graphics, token) {
  graphics.position.set(token.center.x, token.center.y);
  graphics.rotation = getRenderedTokenRotationRadians(token);
}
