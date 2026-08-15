let initialised = false;

function numericAttribute(element, name, fallback) {
  const raw = element.getAttribute(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function groupTotal(group) {
  return [...group.querySelectorAll("[data-bfg-stepper] input[type='number']")]
    .reduce((total, input) => total + (Number(input.value) || 0), 0);
}

/** Enable reusable minus, value and plus controls in dialogs and applications. */
export function initialiseQuantitySteppers() {
  if (initialised) return;
  initialised = true;
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-bfg-step]");
    if (!button) return;
    const stepper = button.closest("[data-bfg-stepper]");
    const input = stepper?.querySelector("input[type='number']");
    if (!input || input.disabled) return;
    event.preventDefault();

    const delta = Number(button.dataset.bfgStep);
    const minimum = numericAttribute(input, "min", 0);
    const maximum = numericAttribute(input, "max", Number.POSITIVE_INFINITY);
    const current = Number(input.value) || 0;
    let next = Math.max(minimum, Math.min(maximum, current + delta));
    const group = stepper.closest("[data-bfg-step-group]");
    const groupMaximum = group ? numericAttribute(group, "data-bfg-step-group-max", Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
    if (delta > 0 && Number.isFinite(groupMaximum)) {
      const available = Math.max(0, groupMaximum - groupTotal(group));
      next = Math.min(next, current + available);
    }
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
