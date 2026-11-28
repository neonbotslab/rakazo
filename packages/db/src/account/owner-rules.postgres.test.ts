import { randomUUID } from "node:crypto";
import { OWNER_RULES_CONFLICT } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../database/client.js";
import { runAsTenant } from "../database/row-security.js";
import { listOwnerRulesVersions, saveOwnerRules } from "./owner-rules.js";

const runtimeUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && runtimeUrl && migrationUrl && runtimeUrl !== migrationUrl
    ? describe
    : describe.skip;

describePostgres("Bot rules saves in PostgreSQL", () => {
  const owner = { userId: randomUUID(), spaceId: "rules-test-space" };
  const other = { userId: randomUUID(), spaceId: owner.spaceId };
  let runtime: ReturnType<typeof createDb>;
  let admin: ReturnType<typeof createDb>;

  beforeAll(async () => {
    runtime = createDb(runtimeUrl!);
    admin = createDb(migrationUrl!);
    await admin.prisma.user.createMany({
      data: [owner, other].map(({ userId }) => ({
        id: userId,
        name: "Rules owner",
        email: `${userId}@rakazo.test`,
      })),
    });
  });

  afterAll(async () => {
    await admin?.prisma.user.deleteMany({ where: { id: { in: [owner.userId, other.userId] } } });
    await Promise.all(
      [runtime, admin].filter(Boolean).map(async ({ prisma, pool }) => {
        await prisma.$disconnect();
        await pool.end();
      }),
    );
  });

  it("serializes competing updates to the same version and isolates it by owner", async () => {
    const { prisma } = runtime;
    const sessionId = randomUUID();
    const first = await runAsTenant(owner, () =>
      saveOwnerRules(prisma, owner.userId, { text: "First", sessionId, expected: null }),
    );
    const results = await Promise.allSettled(
      ["Second A", "Second B"].map((text) =>
        runAsTenant(owner, () =>
          saveOwnerRules(prisma, owner.userId, { text, sessionId, expected: first }),
        ),
      ),
    );
    const [saved] = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(results).toContainEqual({
      status: "rejected",
      reason: expect.objectContaining({ code: OWNER_RULES_CONFLICT }),
    });
    expect(saved).toMatchObject({ id: first.id, revision: 2 });
    expect(
      await runAsTenant(other, () =>
        prisma.ownerRulesVersion.updateMany({
          where: { id: first.id },
          data: { text: "Foreign write" },
        }),
      ),
    ).toEqual({ count: 0 });
    expect(await runAsTenant(owner, () => listOwnerRulesVersions(prisma, owner.userId))).toEqual({
      versions: [saved],
      nextBefore: null,
    });
  });

  it("keeps the previous release's append-only writes readable", async () => {
    const { prisma } = runtime;
    const [legacy] = await runAsTenant(
      other,
      () => prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO "owner_rules_versions" ("userId", "text")
      VALUES (${other.userId}, 'Previous release') RETURNING "id"
    `,
    );
    const { versions } = await runAsTenant(other, () =>
      listOwnerRulesVersions(prisma, other.userId),
    );
    expect(versions).toMatchObject([
      { id: legacy?.id, text: "Previous release", revision: 1, reason: "saved" },
    ]);
  });
});
