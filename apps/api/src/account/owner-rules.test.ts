import type { Actor, OwnerRulesVersion } from "@rakazo/contracts";
import { OWNER_RULES_CONFLICT, OWNER_RULES_MAX_LENGTH } from "@rakazo/contracts";
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
const firstSession = "c4d3be6e-e2a5-42bf-9041-29a0dcbcef35";
const secondSession = "c4d3be6e-e2a5-42bf-9041-29a0dcbcef36";
type Row = Omit<OwnerRulesVersion, "createdAt"> & { createdAt: Date; sessionId: string | null };
type SaveData = Pick<Row, "userId" | "text"> & Partial<Pick<Row, "sessionId" | "reason">>;

function fixture() {
  const rows: Row[] = [];
  const create = vi.fn(async ({ data }: { data: SaveData }) => {
    const row: Row = {
      reason: "saved",
      sessionId: null,
      ...data,
      id: rows.length + 1,
      revision: 1,
      createdAt: new Date("2027-01-01T00:00:00Z"),
    };
    rows.unshift(row);
    return row;
  });
  const findMany = vi.fn(
    async ({ where, take }: { where: { userId: string; id?: { lt: number } }; take: number }) =>
      rows
        .filter((row) => row.userId === where.userId && (!where.id || row.id < where.id.lt))
        .slice(0, take),
  );
  const findFirst = vi.fn(
    async ({ where }: { where: Pick<Row, "userId"> }) =>
      rows.find((row) => row.userId === where.userId) ?? null,
  );
  const findUnique = vi.fn(
    async ({ where }: { where: Pick<Row, "id" | "userId"> | { userId_sessionId: SaveData } }) =>
      rows.find((row) =>
        "userId_sessionId" in where
          ? row.userId === where.userId_sessionId.userId &&
            row.sessionId === where.userId_sessionId.sessionId
          : row.id === where.id && row.userId === where.userId,
      ) ?? null,
  );
  const update = async ({
    where,
    data,
  }: {
    where: Pick<Row, "id" | "userId">;
    data: { text: string; revision: { increment: number } };
  }) => {
    const row = await findUnique({ where });
    if (!row) throw new Error("No version to update");
    row.text = data.text;
    row.revision += data.revision.increment;
    return row;
  };
  const ownerRulesVersion = { create, findMany, findFirst, findUnique, update };
  const tx = { ownerRulesVersion, $queryRaw: async () => [] };
  const $transaction = vi.fn(async (work: (db: typeof tx) => Promise<unknown>) => work(tx));
  const publishSpaceChange = vi.fn();
  const handler = appHandler({
    prisma: { ownerRulesVersion, $transaction },
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

  return { call, create, findMany, $transaction, publishSpaceChange };
}

it("refuses reads and writes by a bot acting for the owner without the owner's session", async () => {
  const { call, findMany, $transaction, publishSpaceChange } = fixture();
  const actingForOwner = { actor: owner };
  const responses = await Promise.all([
    call("list", {}, actingForOwner),
    call(
      "save",
      { text: "Bot-authored text", sessionId: firstSession, expected: null },
      actingForOwner,
    ),
    call("restore", { versionId: 1, expected: null }, actingForOwner),
  ]);
  expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
  expect(findMany).not.toHaveBeenCalled();
  expect($transaction).not.toHaveBeenCalled();
  expect(publishSpaceChange).not.toHaveBeenCalled();
});

it("enforces the 4,000-code-point boundary at the RPC", async () => {
  const { call, create } = fixture();
  const text = "\u{1F680}".repeat(OWNER_RULES_MAX_LENGTH);
  const exact = await call("save", { text, sessionId: firstSession, expected: null });
  expect(exact.status).toBe(200);
  expect(await exact.json()).toMatchObject({ json: { text } });
  const over = await call("save", { text: `${text}t`, sessionId: firstSession, expected: null });
  expect(over.status).toBe(400);
  expect(create).toHaveBeenCalledTimes(1);
});

it("attributes versions to the signed-in user and reads the same history from another Space", async () => {
  const { call, publishSpaceChange } = fixture();
  const text = "  Keep the spacing.\n\nInclude links.  \n";
  const saved = await call("save", {
    text,
    sessionId: firstSession,
    expected: null,
    userId: member.userId,
  });
  expect(saved.status).toBe(200);
  const first = {
    id: 1,
    userId: owner.userId,
    text,
    createdAt: "2027-01-01T00:00:00.000Z",
    revision: 1,
    reason: "saved",
  };
  expect(await saved.json()).toEqual({ json: first });
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

it("coalesces a session's saves and refuses a write based on the old revision", async () => {
  const { call, publishSpaceChange } = fixture();
  const original = await call("save", {
    text: "Original",
    sessionId: firstSession,
    expected: null,
  });
  expect(original.status).toBe(200);
  const expected = { id: 1, revision: 1 };
  const cleared = await call("save", { text: "", sessionId: firstSession, expected });
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toMatchObject({ json: { id: 1, revision: 2, text: "" } });

  const stale = await call("save", { text: "Stale", sessionId: secondSession, expected });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ json: { code: OWNER_RULES_CONFLICT } });
  const history = await call("list", {});
  expect(await history.json()).toMatchObject({
    json: { versions: [{ id: 1, revision: 2, text: "", reason: "saved" }], nextBefore: null },
  });
  expect(publishSpaceChange).toHaveBeenCalledTimes(2);
});

it("restores only the signed-in owner's versions and creates a fresh version each time", async () => {
  const { call, publishSpaceChange } = fixture();
  await call("save", { text: "First", sessionId: firstSession, expected: null });
  await call("save", {
    text: "Second",
    sessionId: secondSession,
    expected: { id: 1, revision: 1 },
  });
  const refused = await call(
    "restore",
    { versionId: 1, expected: null },
    { actor: member, sessionId: "session-member" },
  );
  expect(refused.status).toBe(404);

  const restored = await call("restore", { versionId: 1, expected: { id: 2, revision: 1 } });
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({
    json: { id: 3, userId: owner.userId, text: "First", revision: 1, reason: "restored" },
  });
  const staleRestore = await call("restore", { versionId: 2, expected: { id: 2, revision: 1 } });
  expect(staleRestore.status).toBe(409);

  const restoredAgain = await call("restore", { versionId: 1, expected: { id: 3, revision: 1 } });
  expect(await restoredAgain.json()).toMatchObject({
    json: { id: 4, text: "First", reason: "restored" },
  });
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
