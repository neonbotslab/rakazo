import type {
  OwnerRulesPage,
  OwnerRulesRestoreInput,
  OwnerRulesSaveInput,
  OwnerRulesVersion,
  OwnerRulesVersionRef,
} from "@rakazo/contracts";
import { OWNER_RULES_CONFLICT } from "@rakazo/contracts";
import { ClientError } from "@rakazo/core";
import type {
  OwnerRulesVersion as OwnerRulesVersionRow,
  PrismaClient,
} from "../database/client.js";
import { withTransactionRetry } from "../database/transaction-retry.js";

type OwnerRulesDb = Pick<PrismaClient, "ownerRulesVersion">;
type OwnerRulesWriteDb = Pick<PrismaClient, "$transaction">;
const newestFirst = { id: "desc" } as const;
const pageSize = 20;

class OwnerRulesConflictError extends ClientError {
  constructor() {
    super("CONFLICT", "Bot rules changed. Review the latest version.", OWNER_RULES_CONFLICT);
    this.name = "OwnerRulesConflictError";
  }
}

function versionDto(row: OwnerRulesVersionRow): OwnerRulesVersion {
  const { id, userId, text, createdAt, revision, reason } = row;
  return { id, userId, text, createdAt: createdAt.toISOString(), revision, reason };
}

export async function listOwnerRulesVersions(
  prisma: OwnerRulesDb,
  userId: string,
  before?: number,
): Promise<OwnerRulesPage> {
  const rows = await prisma.ownerRulesVersion.findMany({
    where: { userId, ...(before === undefined ? {} : { id: { lt: before } }) },
    orderBy: newestFirst,
    take: pageSize + 1,
  });
  const versions = rows.slice(0, pageSize).map(versionDto);
  return { versions, nextBefore: rows.length > pageSize ? (versions.at(-1)?.id ?? null) : null };
}

export async function saveOwnerRules(
  prisma: OwnerRulesWriteDb,
  userId: string,
  { text, sessionId, expected }: OwnerRulesSaveInput,
): Promise<OwnerRulesVersion> {
  return writeOwnerRules(prisma, userId, expected, async (versions, latest) => {
    if (latest?.sessionId === sessionId) {
      return versions.update({
        where: { id: latest.id, userId },
        data: { text, revision: { increment: 1 } },
      });
    }

    // Another edit or restore closed this session. Its version stays in history.
    const closedSession = await versions.findUnique({
      where: { userId_sessionId: { userId, sessionId } },
      select: { id: true },
    });
    if (closedSession) throw new OwnerRulesConflictError();
    return versions.create({ data: { userId, text, sessionId } });
  });
}

export async function restoreOwnerRules(
  prisma: OwnerRulesWriteDb,
  userId: string,
  { versionId, expected }: OwnerRulesRestoreInput,
): Promise<OwnerRulesVersion> {
  return writeOwnerRules(prisma, userId, expected, async (versions) => {
    const version = await versions.findUnique({
      where: { id: versionId, userId },
      select: { text: true },
    });
    if (!version) throw new ClientError("NOT_FOUND", "Bot rules version is unavailable.");
    return versions.create({ data: { userId, text: version.text, reason: "restored" } });
  });
}

async function writeOwnerRules(
  prisma: OwnerRulesWriteDb,
  userId: string,
  expected: OwnerRulesVersionRef | null,
  write: (
    versions: OwnerRulesDb["ownerRulesVersion"],
    latest: OwnerRulesVersionRow | null,
  ) => Promise<OwnerRulesVersionRow>,
): Promise<OwnerRulesVersion> {
  const row = await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${`owner-rules:${userId}`}, 0))::text AS "lock"
        `;
        const versions = tx.ownerRulesVersion;
        const latest = await versions.findFirst({ where: { userId }, orderBy: newestFirst });
        if (latest?.id !== expected?.id || latest?.revision !== expected?.revision) {
          throw new OwnerRulesConflictError();
        }
        return write(versions, latest);
      },
      // Read the head from a fresh snapshot after acquiring the lock.
      { isolationLevel: "ReadCommitted" },
    ),
  );
  return versionDto(row);
}
