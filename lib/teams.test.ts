/**
 * Phase 43.1 — Identity & teams domain model.
 * Uses the dispatch rig only for its scratch Prisma client on the new schema.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";
import {
  createTeam,
  inviteMember,
  acceptInvite,
  addMember,
  listMembers,
  listTeams,
  roleOf,
  isMember,
} from "./teams";

let rig: DispatchRig | null = null;
afterEach(async () => {
  await rig?.dispose();
  rig = null;
});

async function mkUser(r: DispatchRig, email: string, name: string) {
  return r.prisma.user.create({ data: { email, name } });
}

describe("teams domain model", () => {
  it("creates a team with an owner membership", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const jp = await mkUser(rig, "jp@coquilabs.ai", "Justin P.");
    const team = await createTeam(rig.prisma, { name: "DeepFinLabs", owner: jp });

    expect(team.slug).toBe("deepfinlabs");
    expect(team.createdById).toBe(jp.id);
    expect(await roleOf(rig.prisma, jp, team)).toBe("owner");
    expect(await isMember(rig.prisma, jp, team)).toBe(true);
  });

  it("disambiguates slugs", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const jp = await mkUser(rig, "jp@coquilabs.ai", "Justin P.");
    const a = await createTeam(rig.prisma, { name: "Finance", owner: jp });
    const b = await createTeam(rig.prisma, { name: "Finance", owner: jp });
    expect(a.slug).toBe("finance");
    expect(b.slug).toBe("finance-2");
  });

  it("invites by email with a token", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const jp = await mkUser(rig, "jp@coquilabs.ai", "Justin P.");
    const team = await createTeam(rig.prisma, { name: "DeepFinLabs", owner: jp });
    const inv = await inviteMember(rig.prisma, {
      team,
      email: "maya@coquilabs.ai",
      role: "member",
      invitedBy: jp,
    });
    expect(inv.status).toBe("pending");
    expect(inv.token.length).toBeGreaterThan(20);
    expect(inv.email).toBe("maya@coquilabs.ai");
  });

  it("re-invite refreshes, no dupes", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const jp = await mkUser(rig, "jp@coquilabs.ai", "Justin P.");
    const team = await createTeam(rig.prisma, { name: "DeepFinLabs", owner: jp });
    const first = await inviteMember(rig.prisma, { team, email: "maya@x.com", role: "member", invitedBy: jp });
    const second = await inviteMember(rig.prisma, { team, email: "maya@x.com", role: "admin", invitedBy: jp });
    const count = await rig.prisma.invite.count({ where: { teamId: team.id, email: "maya@x.com" } });
    expect(count).toBe(1);
    expect(second.token).not.toBe(first.token); // refreshed
    expect(second.role).toBe("admin");
  });

  it("accept adds member and burns the token", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const jp = await mkUser(rig, "jp@coquilabs.ai", "Justin P.");
    const maya = await mkUser(rig, "maya@x.com", "Maya R.");
    const team = await createTeam(rig.prisma, { name: "DeepFinLabs", owner: jp });
    const inv = await inviteMember(rig.prisma, { team, email: "maya@x.com", role: "member", invitedBy: jp });

    const m = await acceptInvite(rig.prisma, { token: inv.token, user: maya });
    expect(m.role).toBe("member");
    expect(await isMember(rig.prisma, maya, team)).toBe(true);

    await expect(
      acceptInvite(rig.prisma, { token: inv.token, user: maya })
    ).rejects.toThrow(/already|invalid|accepted/i);
  });

  it("rejects expired and revoked invites", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const jp = await mkUser(rig, "jp@coquilabs.ai", "Justin P.");
    const maya = await mkUser(rig, "maya@x.com", "Maya R.");
    const team = await createTeam(rig.prisma, { name: "DeepFinLabs", owner: jp });

    const t0 = new Date("2026-07-17T00:00:00Z");
    const inv = await inviteMember(rig.prisma, {
      team, email: "maya@x.com", role: "member", invitedBy: jp, now: t0, ttlMs: 1000,
    });
    const later = new Date(t0.getTime() + 5000);
    await expect(
      acceptInvite(rig.prisma, { token: inv.token, user: maya, now: later })
    ).rejects.toThrow(/expired/i);

    const inv2 = await inviteMember(rig.prisma, { team, email: "dev@x.com", role: "member", invitedBy: jp });
    await rig.prisma.invite.update({ where: { id: inv2.id }, data: { status: "revoked" } });
    const dev = await mkUser(rig, "dev@x.com", "Dev K.");
    await expect(
      acceptInvite(rig.prisma, { token: inv2.token, user: dev })
    ).rejects.toThrow(/revoked|invalid/i);
  });

  it("role + membership checks", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const jp = await mkUser(rig, "jp@coquilabs.ai", "Justin P.");
    const stranger = await mkUser(rig, "x@x.com", "Stranger");
    const team = await createTeam(rig.prisma, { name: "DeepFinLabs", owner: jp });
    expect(await roleOf(rig.prisma, stranger, team)).toBeNull();
    expect(await isMember(rig.prisma, stranger, team)).toBe(false);
  });

  it("listing teams and members", async () => {
    rig = await createDispatchRig({ fakeTimers: false });
    const jp = await mkUser(rig, "jp@coquilabs.ai", "Justin P.");
    const maya = await mkUser(rig, "maya@x.com", "Maya R.");
    const t1 = await createTeam(rig.prisma, { name: "DeepFinLabs", owner: jp });
    const t2 = await createTeam(rig.prisma, { name: "Coquí Labs", owner: jp });
    await addMember(rig.prisma, { team: t1, user: maya, role: "member" });

    const jpTeams = await listTeams(rig.prisma, jp);
    expect(jpTeams.map((t) => t.slug).sort()).toEqual(["coqui-labs", "deepfinlabs"]);
    const mayaTeams = await listTeams(rig.prisma, maya);
    expect(mayaTeams.map((t) => t.slug)).toEqual(["deepfinlabs"]);

    const members = await listMembers(rig.prisma, t1);
    expect(members.map((m) => m.user.email).sort()).toEqual(["jp@coquilabs.ai", "maya@x.com"]);
  });
});
