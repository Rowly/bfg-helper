export function diceFaces(roll) {
  return roll.dice.flatMap(die =>
    die.results
      .filter(result => result.active !== false)
      .map(result => Number(result.result))
  );
}

/** Display through Dice So Nice and record faces without Foundry's summed card. */
export async function publishBFGDice(roll, { speaker, flavor, details } = {}) {
  if (game.dice3d?.showForRoll) {
    await game.dice3d.showForRoll(roll, game.user, true);
  }
  const escape = value => foundry.utils.escapeHTML(String(value));
  const faces = diceFaces(roll);
  return ChatMessage.create({
    speaker,
    content: `<div class="bfg-dice-chat-result">
      ${flavor ? `<strong>${escape(flavor)}</strong><br>` : ""}
      Dice: <strong>${escape(faces.join(", ") || "No dice")}</strong>
      ${details ? `<br>${escape(details)}` : ""}
    </div>`
  });
}
