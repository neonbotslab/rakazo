import type { OwnerRulesPage, OwnerRulesVersion } from "@rakazo/contracts";
import { ClientError } from "@rakazo/core";
import type { PrismaClient } from "../database/client.js";

type OwnerRulesDb = Pick<PrismaClient, "ownerRulesVersion">;
const newestFirst = { id: "desc" } as const;
const pageSize = 20;

function versionDto(
  row: Omit<OwnerRulesVersion, "createdAt"> & { createdAt: Date },
): OwnerRulesVersion {
  return { ...row, createdAt: row.createdAt.toISOString() };
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
  prisma: OwnerRulesDb,
  userId: string,
  text: string,
): Promise<OwnerRulesVersion> {
  return versionDto(await prisma.ownerRulesVersion.create({ data: { userId, text } }));
}

export async function restoreOwnerRules(
  prisma: OwnerRulesDb,
  userId: string,
  versionId: number,
): Promise<OwnerRulesVersion> {
  const version = await prisma.ownerRulesVersion.findUnique({
    where: { id: versionId, userId },
    select: { text: true },
  });
  if (!version) throw new ClientError("NOT_FOUND", "Bot rules version is unavailable.");
  return saveOwnerRules(prisma, userId, version.text);
}
