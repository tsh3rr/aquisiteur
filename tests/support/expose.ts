/** Smallest valid exposé; publishing it creates prospect, contact, exposé and version. */
export function minimalExpose(key: string, company: string, headline = `Hallo ${company}`) {
  return {
    schemaVersion: 1,
    prospect: { key, company, contact: { lastName: "Muster" } },
    meta: { title: `Ideen für ${company}` },
    blocks: [{ id: "start", type: "hero", greeting: "Guten Tag,", headline }],
  };
}
