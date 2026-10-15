/**
 * Lighthouse CI for public exposés (§7.3: mobile first, Lighthouse ≥ 95).
 * URLs come from LHCI_URLS (space separated), set by the CI job after seeding.
 * `is-crawlable` is skipped: exposés are noindex on purpose (§9).
 */
module.exports = {
  ci: {
    collect: {
      url: (process.env.LHCI_URLS ?? "").split(" ").filter(Boolean),
      numberOfRuns: 3,
      settings: {
        chromeFlags: "--no-sandbox --headless=new",
        skipAudits: ["is-crawlable"],
      },
    },
    assert: {
      assertions: {
        // Simulated mobile scores vary by ±3 between runs; the median must reach 0.9 and
        // anything below 0.95 is reported (docs/DECISIONS.md, ADR-0014).
        "categories:performance": ["error", { minScore: 0.9, aggregationMethod: "median-run" }],
        "categories:accessibility": ["error", { minScore: 1 }],
        "categories:best-practices": ["error", { minScore: 0.95 }],
        "categories:seo": ["error", { minScore: 0.95 }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.02 }],
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci" },
  },
};
