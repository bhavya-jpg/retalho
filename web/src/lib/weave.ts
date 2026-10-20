// The collection weave: one row per container, one column per week, a filled cell when the
// container was emptied that week in a simulated run. Scenario A (every container, every week)
// reads as a plain weave; Scenario B leaves gaps where collection was not needed.
import type { SeedRun } from "../types";

export type Weave = { ids: string[]; weeks: number[]; cells: boolean[][]; collections: number };

export function collectionWeave(run: SeedRun, containerIds: string[]): Weave {
  const weeks = run.weeks.map((w) => w.week);
  const byWeek = run.weeks.map((w) => new Set(w.routes.flatMap((r) => r.stop_ids)));
  const unknown = [...new Set(byWeek.flatMap((s) => [...s]))].filter((id) => !containerIds.includes(id));
  if (unknown.length) throw new Error(`run collects stops outside the network: ${unknown.slice(0, 3).join(", ")}`);
  const cells = containerIds.map((id) => byWeek.map((s) => s.has(id)));
  return { ids: containerIds, weeks, cells, collections: cells.flat().filter(Boolean).length };
}

/** Same row order for two weaves (so A and B line up), most-collected-in-`by` first, then id. */
export function sharedOrder(by: Weave): string[] {
  return by.ids
    .map((id, i) => ({ id, n: by.cells[i].filter(Boolean).length }))
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
    .map((x) => x.id);
}
