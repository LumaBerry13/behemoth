// Chest-style forms (vendored Chest-UI on top of @minecraft/server-ui).
// Part of the adapter layer: the only other place that imports @minecraft/*.
import { FormCancelationReason } from "@minecraft/server-ui";
import { system } from "@minecraft/server";
import { ChestFormData } from "./vendor/chest_ui/forms.js";

/**
 * @typedef {{ slot: number, name: string, lore?: string[], icon: string, amount?: number }} ChestButton
 */

/** A form can't open while chat (or another screen) is still open: retry briefly. */
const BUSY_RETRIES = 40;
const BUSY_WAIT_TICKS = 5;

export const Ui = {
  /**
   * Show a 54-slot chest form and resolve with the clicked slot, or undefined if
   * the player closed it (or never became available).
   * @param {import("@minecraft/server").Player} player
   * @param {string} title
   * @param {ChestButton[]} buttons
   * @returns {Promise<number | undefined>}
   */
  async showChest(player, title, buttons) {
    for (let attempt = 0; attempt < BUSY_RETRIES; attempt++) {
      if (!player.isValid) return undefined;
      const form = new ChestFormData("large").title(title);
      for (const b of buttons) form.button(b.slot, b.name, b.lore ?? [], b.icon, b.amount ?? 1);
      const res = await form.show(player);
      if (res.canceled && res.cancelationReason === FormCancelationReason.UserBusy) {
        await system.waitTicks(BUSY_WAIT_TICKS);
        continue;
      }
      return res.canceled ? undefined : res.selection;
    }
    return undefined;
  },
};
