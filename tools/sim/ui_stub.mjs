// Minimal @minecraft/server-ui stand-in for the headless simulator. Forms are
// recorded (title + buttons) and resolve as "closed" unless a test queues a click.
export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };

/** Forms shown so far: { title, buttons: [{ text, icon }] } */
export const shown = [];
/** Slots to "click" on the next forms, in order. */
export const clicks = [];

export class ActionFormData {
  constructor() { this.data = { title: undefined, buttons: [] }; }
  title(t) { this.data.title = t; return this; }
  body() { return this; }
  button(text, icon) { this.data.buttons.push({ text, icon }); return this; }
  async show() {
    shown.push(this.data);
    if (clicks.length) return { canceled: false, selection: clicks.shift() };
    return { canceled: true, cancelationReason: FormCancelationReason.UserClosed };
  }
}
