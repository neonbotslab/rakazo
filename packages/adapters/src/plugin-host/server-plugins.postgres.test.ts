import { randomUUID } from "node:crypto";
import { createPluginRegistry } from "@rakazo/core/plugin-host";
import { createDb, runAsSystem, runAsTenant } from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHostPluginSettings } from "./server-plugins.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE && databaseUrl ? describe : describe.skip;

describePostgres("host plugin preferences", () => {
  const db = createDb(databaseUrl!);
  const owner = `plugin-test-${randomUUID()}`;
  const other = `plugin-test-${randomUUID()}`;
  const people = [owner, other];
  const id = "test/sample";
  const settings = () =>
    createHostPluginSettings(
      db.prisma,
      createPluginRegistry([
        { manifest: { id, name: "Sample", version: "1", apiVersion: 1 }, hooks: {} },
      ]),
    );
  const as = <T>(userId: string, work: () => Promise<T>) =>
    runAsTenant({ userId, spaceId: "test-space" }, work);

  beforeAll(async () => {
    await runAsSystem("seed plugin preference fixtures", () =>
      db.prisma.user.createMany({
        data: people.map((id) => ({ id, name: "Fixture", email: `${id}@example.test` })),
      }),
    );
  });

  afterAll(async () => {
    await runAsSystem("remove plugin preference fixtures", () =>
      db.prisma.user.deleteMany({ where: { id: { in: people } } }),
    );
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  it("keeps each user's choice across service instances and refuses cross-user writes", async () => {
    const listed = (userId: string) => as(userId, () => settings().list(userId));
    expect(await listed(owner)).toEqual([{ id, name: "Sample", enabled: false }]);
    await as(owner, () => settings().setEnabled(owner, { id, enabled: true }));
    expect(await listed(owner)).toEqual([{ id, name: "Sample", enabled: true }]);
    expect(await listed(other)).toEqual([{ id, name: "Sample", enabled: false }]);

    await expect(
      as(other, () => settings().setEnabled(owner, { id, enabled: false })),
    ).rejects.toThrow();
    await expect(
      as(owner, () => settings().setEnabled(owner, { id: "test/missing", enabled: true })),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
    await as(owner, () => settings().setEnabled(owner, { id, enabled: false }));
    expect(await listed(owner)).toEqual([{ id, name: "Sample", enabled: false }]);
  });
});
