import { describe, expect, it } from "vitest";
import { modulesPath, qrMatrix, qrSvg } from "./qr";

describe("qrSvg", () => {
  it("renders a print-sized code with a title", () => {
    const svg = qrSvg({ url: "https://pixelwerk.de/AbCdEf123456" });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="30mm" height="30mm"/);
    expect(svg).toContain("<title>QR-Code: https://pixelwerk.de/AbCdEf123456</title>");
    expect(svg).toMatch(/<path d="(M\d+ \d+h1v1h-1z)+" fill="#000"\/>/);
  });

  it("frames the code with the call to action and the typed link", () => {
    const svg = qrSvg({
      url: "https://pixelwerk.de/AbCdEf123456",
      framed: true,
      caption: "pixelwerk.de/k7m2 <b>",
    });
    expect(svg).toContain('width="56mm"');
    expect(svg).toContain(">Scannen Sie für Ihre<");
    expect(svg).toContain(">persönlichen Vorschläge<");
    expect(svg).toContain("pixelwerk.de/k7m2 &#60;b&#62;");
  });
});

describe("qrMatrix", () => {
  it("has the same modules as the classic path, without quiet zone", () => {
    const url = "https://pixelwerk.de/UF5iEaXCYXsy";
    const matrix = qrMatrix(url);
    const classic = modulesPath(url);
    expect(matrix.size).toBe(classic.size - 8);
    expect(matrix.bits).toHaveLength(matrix.size ** 2);
    expect(matrix.bits.split("").filter((bit) => bit === "1")).toHaveLength(
      classic.path.split("M").length - 1,
    );
  });

  it("grows at level H, which leaves room for the badge", () => {
    const url = "https://pixelwerk.de/UF5iEaXCYXsy";
    expect(qrMatrix(url, "H").size).toBeGreaterThan(qrMatrix(url).size);
  });
});
