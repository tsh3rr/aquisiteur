import { and, asc, count, eq, inArray, ne } from "drizzle-orm";
import type { Transaction } from "@/db";
import { auditLog, exposes, invoices, offers, projects, prospects } from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { FIRST_PROJECT_NAME, type ProjectForm, type ProjectStatus } from "@/domain/projects";

/** Projects of a customer (§7.10). Cockpit functions run inside withTenant. */

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: Date;
  exposes: { id: string; title: string }[];
  offerCount: number;
}

export async function listProjects(
  tx: Transaction,
  workspaceId: string,
  prospectId: string,
): Promise<ProjectSummary[]> {
  const rows = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.prospectId, prospectId)))
    .orderBy(asc(projects.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [exposeRows, offerRows] = await Promise.all([
    tx
      .select({ id: exposes.id, title: exposes.title, projectId: exposes.projectId })
      .from(exposes)
      .where(and(eq(exposes.workspaceId, workspaceId), inArray(exposes.projectId, ids))),
    tx
      .select({ projectId: offers.projectId, count: count() })
      .from(offers)
      .where(and(eq(offers.workspaceId, workspaceId), inArray(offers.projectId, ids)))
      .groupBy(offers.projectId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    exposes: exposeRows
      .filter((expose) => expose.projectId === row.id)
      .map(({ id, title }) => ({ id, title })),
    offerCount: offerRows.find((offer) => offer.projectId === row.id)?.count ?? 0,
  }));
}

export async function loadProject(tx: Transaction, workspaceId: string, projectId: string) {
  const [row] = await tx
    .select({
      project: projects,
      company: prospects.companyName,
      prospectStatus: prospects.status,
    })
    .from(projects)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, projects.workspaceId), eq(prospects.id, projects.prospectId)),
    )
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)));
  if (!row) return null;
  const exposeRows = await tx
    .select({ id: exposes.id, title: exposes.title, slug: exposes.slug })
    .from(exposes)
    .where(and(eq(exposes.workspaceId, workspaceId), eq(exposes.projectId, projectId)));
  return { ...row.project, company: row.company, exposes: exposeRows };
}

export async function createProject(
  tx: Transaction,
  actor: Actor,
  prospectId: string,
  form: ProjectForm,
): Promise<string | null> {
  const [prospect] = await tx
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, actor.workspaceId), eq(prospects.id, prospectId)));
  if (!prospect) return null;
  const [row] = await tx
    .insert(projects)
    .values({ workspaceId: actor.workspaceId, prospectId, ...form })
    .returning({ id: projects.id });
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "project.created",
    targetType: "prospect",
    targetId: prospectId,
    meta: { projectId: row!.id, name: form.name },
  });
  return row!.id;
}

export async function updateProject(
  tx: Transaction,
  actor: Actor,
  projectId: string,
  form: ProjectForm & { status: ProjectStatus },
): Promise<string | null> {
  const [row] = await tx
    .update(projects)
    .set(form)
    .where(and(eq(projects.workspaceId, actor.workspaceId), eq(projects.id, projectId)))
    .returning({ prospectId: projects.prospectId });
  return row?.prospectId ?? null;
}

/**
 * Deletes a project that holds nothing worth keeping: no exposé and no offer
 * that was ever sent. Draft offers go with it.
 */
export async function deleteProject(
  tx: Transaction,
  actor: Actor,
  projectId: string,
): Promise<{ prospectId: string } | { error: "not_found" | "in_use" }> {
  const [project] = await tx
    .select({ prospectId: projects.prospectId, name: projects.name })
    .from(projects)
    .where(and(eq(projects.workspaceId, actor.workspaceId), eq(projects.id, projectId)));
  if (!project) return { error: "not_found" };
  const [[exposeCount], [sentCount], [invoiceCount]] = await Promise.all([
    tx
      .select({ count: count() })
      .from(exposes)
      .where(and(eq(exposes.workspaceId, actor.workspaceId), eq(exposes.projectId, projectId))),
    tx
      .select({ count: count() })
      .from(offers)
      .where(
        and(
          eq(offers.workspaceId, actor.workspaceId),
          eq(offers.projectId, projectId),
          ne(offers.status, "draft"),
        ),
      ),
    tx
      .select({ count: count() })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, actor.workspaceId), eq(invoices.projectId, projectId))),
  ]);
  if (
    (exposeCount?.count ?? 0) > 0 ||
    (sentCount?.count ?? 0) > 0 ||
    (invoiceCount?.count ?? 0) > 0
  ) {
    return { error: "in_use" };
  }
  await tx
    .delete(projects)
    .where(and(eq(projects.workspaceId, actor.workspaceId), eq(projects.id, projectId)));
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "project.deleted",
    targetType: "prospect",
    targetId: project.prospectId,
    meta: { projectId, name: project.name },
  });
  return { prospectId: project.prospectId };
}

/**
 * The project a newly published exposé belongs to: the prospect's oldest
 * project, or a new „Erstakquise“ (§7.10).
 */
export async function ensureProject(
  tx: Transaction,
  workspaceId: string,
  prospectId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.prospectId, prospectId)))
    .orderBy(asc(projects.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(projects)
    .values({ workspaceId, prospectId, name: FIRST_PROJECT_NAME })
    .returning({ id: projects.id });
  return created!.id;
}

/** Moves the project forward when an offer goes out or is accepted; never backwards. */
export async function advanceProject(
  tx: Transaction,
  workspaceId: string,
  projectId: string,
  to: "offered" | "ordered",
): Promise<void> {
  const from: ProjectStatus[] = to === "offered" ? ["idea"] : ["idea", "offered"];
  await tx
    .update(projects)
    .set({ status: to })
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
        inArray(projects.status, from),
      ),
    );
}
