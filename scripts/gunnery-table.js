/** Gunnery Table result columns for Firepower 1 through 20. */
export const GUNNERY_TABLE = Object.freeze([
  null,
  [1, 1, 1, 0, 0],
  [2, 1, 1, 1, 0],
  [3, 2, 2, 1, 1],
  [4, 3, 2, 1, 1],
  [5, 4, 3, 2, 1],
  [5, 4, 3, 2, 1],
  [6, 5, 4, 2, 1],
  [7, 6, 4, 3, 2],
  [8, 6, 5, 3, 2],
  [9, 7, 5, 4, 2],
  [10, 8, 6, 4, 2],
  [11, 8, 6, 4, 2],
  [12, 9, 7, 5, 3],
  [13, 10, 7, 5, 3],
  [14, 11, 8, 5, 3],
  [14, 11, 8, 6, 3],
  [15, 12, 9, 6, 3],
  [16, 13, 9, 6, 4],
  [17, 13, 10, 7, 4],
  [18, 14, 10, 7, 4]
]);

export const GUNNERY_COLUMNS = Object.freeze([
  "Defences",
  "Closing capital ship",
  "Closing escort / moving-away capital ship",
  "Moving-away escort / abeam capital ship",
  "Abeam escort / ordnance"
]);

function baseColumn({ targetClass, orientation, countsAsDefences = false }) {
  if (countsAsDefences || targetClass === "defence") return 0;
  if (targetClass === "ordnance") return 4;

  const escort = targetClass === "escort";
  if (orientation === "closing") return escort ? 2 : 1;
  if (orientation === "moving-away") return escort ? 3 : 2;
  return escort ? 4 : 3;
}

function splitFirepower(firepower) {
  const value = Math.max(0, Math.trunc(Number(firepower)));
  const parts = [];
  let remaining = value;
  while (remaining > 20) {
    parts.push(20);
    remaining -= 20;
  }
  if (remaining > 0) parts.push(remaining);
  return parts;
}

export function calculateBatteryDice({
  firepower,
  targetClass = "capital",
  orientation = "abeam",
  rangeCm,
  interveningBlastMarkers = false,
  countsAsDefences = false
}) {
  const numericFirepower = Math.trunc(Number(firepower));
  const numericRange = Number(rangeCm);
  if (!(numericFirepower > 0)) throw new Error("Battery Firepower must be greater than zero.");
  if (!Number.isFinite(numericRange) || numericRange < 0) throw new Error("Battery range is invalid.");

  const startingColumn = baseColumn({ targetClass, orientation, countsAsDefences });
  const shifts = [];
  let shift = 0;
  if (numericRange <= 15) {
    shift -= 1;
    shifts.push({ direction: "left", reason: "Target within 15 cm" });
  }
  if (numericRange > 30) {
    shift += 1;
    shifts.push({ direction: "right", reason: "Target more than 30 cm away" });
  }
  if (interveningBlastMarkers) {
    shift += 1;
    shifts.push({ direction: "right", reason: "Intervening Blast Markers" });
  }

  const finalColumn = Math.max(0, Math.min(GUNNERY_COLUMNS.length - 1, startingColumn + shift));
  const firepowerParts = splitFirepower(numericFirepower);
  const diceParts = firepowerParts.map(part => GUNNERY_TABLE[part][finalColumn]);

  return {
    firepower: numericFirepower,
    firepowerParts,
    diceParts,
    attackDice: diceParts.reduce((total, dice) => total + dice, 0),
    startingColumn,
    startingColumnLabel: GUNNERY_COLUMNS[startingColumn],
    finalColumn,
    columnLabel: GUNNERY_COLUMNS[finalColumn],
    shifts
  };
}
