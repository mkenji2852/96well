import { describe, expect, it } from "vitest";
import { draftIdFor, mergePlateWellChanges, type OfflineActor } from "@/lib/offline-db";
import type { WellInput } from "@/types/domain";

const well = (rowIndex: number, columnIndex: number, state: WellInput["state"]): WellInput => ({
  rowIndex,
  columnIndex,
  state,
  source: "MANUAL",
});

describe("offline draft merge", () => {
  it("auto-merges non-conflicting local and server well changes", () => {
    const base = [well(0, 0, "UNREAD"), well(0, 1, "UNREAD")];
    const local = [well(0, 0, "GROWTH"), well(0, 1, "UNREAD")];
    const server = [well(0, 0, "UNREAD"), well(0, 1, "INHIBITED")];

    const result = mergePlateWellChanges(base, local, server);

    expect(result.conflicts).toHaveLength(0);
    expect(result.localOnlyCount).toBe(1);
    expect(result.serverOnlyCount).toBe(1);
    expect(result.mergedWells.find((item) => item.rowIndex === 0 && item.columnIndex === 0)?.state).toBe("GROWTH");
    expect(result.mergedWells.find((item) => item.rowIndex === 0 && item.columnIndex === 1)?.state).toBe("INHIBITED");
  });

  it("marks same-well divergent changes as manual conflicts and keeps server value in the candidate", () => {
    const result = mergePlateWellChanges(
      [well(0, 0, "UNREAD")],
      [well(0, 0, "GROWTH")],
      [well(0, 0, "INHIBITED")],
    );

    expect(result.conflicts).toEqual([expect.objectContaining({
      key: "0:0",
      baseState: "UNREAD",
      localState: "GROWTH",
      serverState: "INHIBITED",
    })]);
    expect(result.mergedWells.find((item) => item.rowIndex === 0 && item.columnIndex === 0)?.state).toBe("INHIBITED");
  });

  it("namespaces drafts by environment, organization, user, and plate", () => {
    const actorA: OfflineActor = { userId: "user-a", organizationId: "org-a" };
    const actorB: OfflineActor = { userId: "user-b", organizationId: "org-a" };
    const actorC: OfflineActor = { userId: "user-a", organizationId: "org-b" };

    expect(draftIdFor(actorA, "plate-1", "dev")).toBe("dev::org-a::user-a::plate-1");
    expect(draftIdFor(actorA, "plate-1", "dev")).not.toBe(draftIdFor(actorB, "plate-1", "dev"));
    expect(draftIdFor(actorA, "plate-1", "dev")).not.toBe(draftIdFor(actorC, "plate-1", "dev"));
    expect(draftIdFor(actorA, "plate-1", "dev")).not.toBe(draftIdFor(actorA, "plate-1", "prod"));
  });
});
