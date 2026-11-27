import type { Actor, OwnerRulesVersion } from "@rakazo/contracts";
import { OWNER_RULES_MAX_LENGTH } from "@rakazo/contracts";
import { expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import { appHandler, handle } from "../router-test-support.js";

const owner: Actor = {
  userId: "owner",
  spaceId: "space-a",
  email: "owner@example.test",
  isDeploymentOwner: false,
};
const member: Actor = { ...owner, userId: "member", email: "member@example.test" };
type Row = Omit<OwnerRulesVersion, "createdAt"> & { createdAt: Date };

function fixture() {
  const rows: Row[] = [];
  const create = vi.fn(async ({ data }: { data: Pick<Row, "userId" | "text"> }) => {
    const row = { ...data, id: rows.length + 1, createdAt: new Date("2027-01-01T00:00:00Z") };
    rows.unshift(row);
    return row;
  });
  const findMany = vi.fn(
    async ({ where, take }: { where: { userId: string; id?: { lt: number } }; take: number }) =>
      rows
        .filter((row) => row.userId === where.userId && (!where.id || row.id < where.id.lt))
        .slice(0, take),
  );
  const findUnique = vi.fn(async ({ where }: { where: Pick<Row, "id" | "userId"> }) =>
    rows.find((row) => row.id === where.id && row.userId === where.userId),
  );
  const publishSpaceChange = vi.fn();
  const handler = appHandler({
    prisma: { ownerRulesVersion: { create, findMany, findUnique } },
    events: { publishSpaceChange },
  } as unknown as RouterDeps);

  function call(
    method: "list" | "save" | "restore",
    json: object,
    context: { actor: Actor; sessionId?: string } = { actor: owner, sessionId: "session-owner" },
  ) {
    return handle(
      handler,
      new Request(`http://rakazo.test/rpc/ownerRules/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json }),
      }),
      { prefix: "/rpc", context },
    );
  }

  return { call, create, findMany, findUnique, publishSpaceChange };
}

it("refuses reads and writes by a bot acting for the owner without the owner's session", async () => {
  const { call, create, findMany, findUnique, publishSpaceChange } = fixture();
  const actingForOwner = { actor: owner };
  const responses = await Promise.all([
    call("list", {}, actingForOwner),
    call("save", { text: "Bot-authored text" }, actingForOwner),
    call("restore", { versionId: 1 }, actingForOwner),
  ]);
  expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  expect(create).not.toHaveBeenCalled();
  expect(findMany).not.toHaveBeenCalled();
  expect(findUnique).not.toHaveBeenCalled();
  expect(publishSpaceChange).not.toHaveBeenCalled();
});

it("enforces the 4,000-character boundary at the RPC", async () => {
  const { call, create } = fixture();
  const text = "t".repeat(OWNER_RULES_MAX_LENGTH);
  const exact = await call("save", { text });
  expect(exact.status).toBe(200);
  expect(await exact.json()).toMatchObject({ json: { text } });
  expect((await call("save", { text: `${text}t` })).status).toBe(400);
  expect(create).toHaveBeenCalledTimes(1);
});

it("attributes versions to the signed-in user and reads the same history from another Space", async () => {
  const { call, publishSpaceChange } = fixture();
  const text = "  Keep the spacing.\n\nInclude links.  \n";
  const saved = await call("save", { text, userId: member.userId });
  expect(saved.status).toBe(200);
  const first = { id: 1, userId: owner.userId, text, createdAt: "2027-01-01T00:00:00.000Z" };
  expect(await saved.json()).toMatchObject({ json: first });
  expect(publishSpaceChange).toHaveBeenCalledWith(`preferences:${owner.userId}`, "preferences");

  const otherSpace = await call(
    "list",
    {},
    { actor: { ...owner, spaceId: "space-b" }, sessionId: "session-owner" },
  );
  expect(await otherSpace.json()).toMatchObject({ json: { versions: [first], nextBefore: null } });
  const otherAccount = await call("list", {}, { actor: member, sessionId: "session-member" });
  expect(await otherAccount.json()).toMatchObject({ json: { versions: [], nextBefore: null } });
});

it("restores only the signed-in owner's versions and creates a fresh version each time", async () => {
  const { call, publishSpaceChange } = fixture();
  await call("save", { text: "First" });
  await call("save", { text: "Second" });
  const refused = await call(
    "restore",
    { versionId: 1 },
    { actor: member, sessionId: "session-member" },
  );
  expect(refused.status).toBe(404);

  const restored = await call("restore", { versionId: 1 });
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({
    json: { id: 3, userId: owner.userId, text: "First" },
  });
  const duplicate = await call("save", { text: "First" });
  expect(await duplicate.json()).toMatchObject({ json: { id: 4, text: "First" } });
  const history = await call("list", {});
  expect(await history.json()).toMatchObject({
    json: { versions: [{ id: 4 }, { id: 3 }, { id: 2 }, { id: 1 }], nextBefore: null },
  });
  expect(publishSpaceChange).toHaveBeenCalledTimes(4);
});

it("paginates history without dropping older versions", async () => {
  const { call, create } = fixture();
  for (let id = 1; id <= 21; id++) {
    await create({ data: { userId: owner.userId, text: `Version ${id}` } });
  }
  const recent = await call("list", {});
  expect(await recent.json()).toMatchObject({
    json: {
      versions: Array.from({ length: 20 }, (_, index) => ({ id: 21 - index })),
      nextBefore: 2,
    },
  });
  const older = await call("list", { before: 2 });
  expect(await older.json()).toMatchObject({ json: { versions: [{ id: 1 }], nextBefore: null } });
});
