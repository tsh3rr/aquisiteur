import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { Transaction } from "@/db";
import { exposes, exposeVersions, prospects, users } from "@/db/schema";

export async function listExposes(tx: Transaction, workspaceId: string) {
  return tx
    .select({
      id: exposes.id,
      title: exposes.title,
      slug: exposes.slug,
      refCode: exposes.refCode,
      unpublishedAt: exposes.unpublishedAt,
      updatedAt: exposes.updatedAt,
      company: prospects.companyName,
      prospectStatus: prospects.status,
      version: exposeVersions.version,
    })
    .from(exposes)
    .innerJoin(prospects, eq(prospects.id, exposes.prospectId))
    .leftJoin(exposeVersions, eq(exposeVersions.id, exposes.currentVersionId))
    .where(eq(exposes.workspaceId, workspaceId))
    .orderBy(desc(exposes.updatedAt));
}

export async function getExposeDetail(tx: Transaction, workspaceId: string, exposeId: string) {
  const [expose] = await tx
    .select({
      id: exposes.id,
      title: exposes.title,
      slug: exposes.slug,
      refCode: exposes.refCode,
      unpublishedAt: exposes.unpublishedAt,
      currentVersionId: exposes.currentVersionId,
      company: prospects.companyName,
      prospectKey: prospects.key,
      prospectStatus: prospects.status,
      doNotContactAt: prospects.doNotContactAt,
    })
    .from(exposes)
    .innerJoin(prospects, eq(prospects.id, exposes.prospectId))
    .where(and(eq(exposes.workspaceId, workspaceId), eq(exposes.id, exposeId)));
  if (!expose) return null;
  const versions = await tx
    .select({
      id: exposeVersions.id,
      version: exposeVersions.version,
      createdAt: exposeVersions.createdAt,
      source: exposeVersions.source,
      publishedBy: users.name,
    })
    .from(exposeVersions)
    .leftJoin(users, eq(users.id, exposeVersions.publishedByUserId))
    .where(eq(exposeVersions.exposeId, exposeId))
    .orderBy(desc(exposeVersions.version));
  return { expose, versions };
}
