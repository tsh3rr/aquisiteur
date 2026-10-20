import { describe, expect, it } from "vitest";
import { tintLogo } from "./tint";

const pixels = (...rgba: number[][]) => new Uint8ClampedArray(rgba.flat());

describe("tintLogo()", () => {
  it("turns dark marks on white into ink on the accent", () => {
    const data = pixels([0, 0, 0, 255], [255, 255, 255, 255], [250, 250, 250, 255]);
    tintLogo(data, "#2a7a66", "#ffffff");
    expect([...data]).toEqual([255, 255, 255, 255, 42, 122, 102, 255, 42, 122, 102, 255]);
  });

  it("uses the alpha channel of a transparent logo, whatever its colour", () => {
    const data = pixels([255, 255, 255, 255], [255, 255, 255, 0]);
    tintLogo(data, "#000000", "#ff0000");
    expect([...data]).toEqual([255, 0, 0, 255, 0, 0, 0, 255]);
  });
});
