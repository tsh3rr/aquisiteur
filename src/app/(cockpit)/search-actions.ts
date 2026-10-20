"use server";

import { assertCan } from "@/domain/authz";
import { searchQuerySchema, type SearchHit } from "@/domain/search";
import { searchWorkspace } from "@/server/search";
import { requireCockpit } from "@/server/session";

/** Records for the command palette (§7.8); the commands themselves are static. */
export async function searchCockpit(query: string): Promise<SearchHit[]> {
  const parsed = searchQuerySchema.safeParse(query);
  if (!parsed.success) return [];
  const { actor, workspace, tenant } = await requireCockpit();
  assertCan(actor, "prospects.read", { workspaceId: workspace.id });
  return tenant((tx) => searchWorkspace(tx, workspace.id, parsed.data));
}
