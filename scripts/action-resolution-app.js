const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class BFGActionResolutionApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "bfg-helper-action-resolution",
    classes: ["bfg-helper", "bfg-action-resolution-window"],
    tag: "section",
    window: { title: "Battlefleet Gothic Resolution", icon: "fa-solid fa-dice-d6", resizable: true },
    position: { width: 470, height: "auto" }
  };

  static PARTS = { body: { template: "modules/bfg-helper/templates/action-resolution.hbs" } };

  constructor(config, options = {}) {
    super(options);
    this.config = config;
    this.stage = "details";
    this.outcome = null;
    this.error = null;
    this.applied = false;
    this._completion = new Promise(resolve => { this._complete = resolve; });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return foundry.utils.mergeObject(context, {
      heading: this.config.heading,
      detailsHtml: this.config.detailsHtml,
      resultHtml: this.outcome?.resultHtml ?? "",
      detailsStage: this.stage === "details",
      waitingStage: this.stage === "waiting",
      resultStage: this.stage === "result",
      appliedStage: this.stage === "applied",
      error: this.error,
      rollLabel: this.config.rollLabel ?? "Roll and resolve",
      applyLabel: this.config.applyLabel ?? "Apply result",
      canApply: Boolean(game.user?.isGM)
    }, { inplace: false });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const bind = (action, handler) => this.element.querySelector(`[data-bfg-action="${action}"]`)?.addEventListener("click", async event => {
      event.preventDefault();
      await handler();
    });
    bind("cancel", () => this.close());
    bind("roll", async () => {
      try {
        this.stage = "waiting";
        this.error = null;
        await this.render({ force: true });
        [this.outcome] = await Promise.all([
          this.config.roll(),
          new Promise(resolve => setTimeout(resolve, 650))
        ]);
        this.stage = "result";
      } catch (error) {
        console.error("BFG Helper | Action resolution failed", error);
        this.error = error.message ?? String(error);
        this.stage = "details";
      }
      await this.render({ force: true });
    });
    bind("apply", async () => {
      try {
        await this.config.apply(this.outcome, this.element);
        this.applied = true;
        this.stage = "applied";
        await this.render({ force: true });
        this._complete?.(true);
        this._complete = null;
      } catch (error) {
        console.error("BFG Helper | Applying action result failed", error);
        this.error = error.message ?? String(error);
        await this.render({ force: true });
      }
    });
    bind("close", () => this.close());
  }

  async close(options = {}) {
    this._complete?.(false);
    this._complete = null;
    return super.close(options);
  }
}

let activeResolution = null;

export async function openActionResolution(config) {
  if (activeResolution?.rendered) await activeResolution.close();
  const app = new BFGActionResolutionApplication(config);
  activeResolution = app;
  await app.render({ force: true });
  const result = await app._completion;
  if (activeResolution === app && !app.rendered) activeResolution = null;
  return result;
}
