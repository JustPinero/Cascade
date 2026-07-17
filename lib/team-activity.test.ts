/**
 * Phase 45.1 — shared work visibility (unified team activity feed).
 */
import { describe, it, expect, afterEach } from "vitest";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";
import { createTeam } from "./teams";
import {
  assignDispatchToTeam,
  assignTaskToTeam,
  listTeamActivity,
  listMemberWork,
} from "./team-activity";

let rig: DispatchRig | null = null;
afterEach(async () => {
  await rig?.dispose();
  rig = null;
});

async function scaffold(r: DispatchRig) {
  const jp = await r.prisma.user.create({ data: { email: "jp@x.com", name: "Justin P." } });
  const maya = await r.prisma.user.create({ data: { email: "maya@x.com", name: "Maya R." } });
  const team = await createTeam(r.prisma, { name: "DeepFinLabs", owner: jp });
  const project = await r.prisma.project.create({
    data: { name: "medipal", slug: "medipal", path: "/p/medipal" },
  });
  return { jp, maya, team, project };
}

describe("team activity feed", () => {
  it("unified feed spans dispatches and tasks; excludes outside work", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const { jp, maya, team, project } = await scaffold(rig);

    // An agent dispatch (owned by jp) and a human task (owned by maya)
    const d = await rig.prisma.dispatch.create({
      data: { projectId: project.id, projectSlug: "medipal", mode: "continue", status: "started" },
    });
    const t = await rig.prisma.humanTask.create({
      data: { title: "Verify scheduling PR", projectSlug: "medipal", status: "pending" },
    });
    // A dispatch NOT assigned to the team (should be excluded)
    await rig.prisma.dispatch.create({
      data: { projectId: project.id, projectSlug: "medipal", mode: "audit", status: "started" },
    });

    await assignDispatchToTeam(rig.prisma, { dispatchId: d.id, team, owner: jp });
    await assignTaskToTeam(rig.prisma, { taskId: t.id, team, owner: maya });

    const feed = await listTeamActivity(rig.prisma, team);
    expect(feed).toHaveLength(2);
    expect(feed.map((f) => f.kind).sort()).toEqual(["dispatch", "task"]);
    expect(feed.every((f) => f.projectSlug === "medipal")).toBe(true);
  });

  it("items are normalized + owner-attributed", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const { maya, team, project } = await scaffold(rig);
    const t = await rig.prisma.humanTask.create({
      data: { title: "Verify scheduling PR", projectSlug: "medipal", status: "pending" },
    });
    await assignTaskToTeam(rig.prisma, { taskId: t.id, team, owner: maya });

    const feed = await listTeamActivity(rig.prisma, team);
    const item = feed[0];
    expect(item.kind).toBe("task");
    expect(item.title).toBe("Verify scheduling PR");
    expect(item.status).toBe("pending");
    expect(item.owner?.name).toBe("Maya R.");
    void project;
  });

  it("member work filter returns only that member's owned items", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const { jp, maya, team, project } = await scaffold(rig);
    const d = await rig.prisma.dispatch.create({
      data: { projectId: project.id, projectSlug: "medipal", mode: "continue", status: "started" },
    });
    const t = await rig.prisma.humanTask.create({
      data: { title: "task", projectSlug: "medipal", status: "pending" },
    });
    await assignDispatchToTeam(rig.prisma, { dispatchId: d.id, team, owner: jp });
    await assignTaskToTeam(rig.prisma, { taskId: t.id, team, owner: maya });

    const jpWork = await listMemberWork(rig.prisma, { team, user: jp });
    expect(jpWork).toHaveLength(1);
    expect(jpWork[0].kind).toBe("dispatch");
    expect(jpWork[0].owner?.id).toBe(jp.id);
  });
});
