import type { LetterDispatchProvider } from "../types";

/**
 * The owner prints and posts the letter (§7.9). Nothing leaves the app;
 * the provider only hands out references so manual letters pass through
 * the same states as letters sent by a print API.
 */
export const manualLetters: LetterDispatchProvider = {
  id: "manual",
  tracksDelivery: false,
  async send(letter) {
    return { providerRef: `manual-${letter.letterId}` };
  },
  async getStatus() {
    return null;
  },
  async cancel() {},
  async estimateCost() {
    return null;
  },
};
