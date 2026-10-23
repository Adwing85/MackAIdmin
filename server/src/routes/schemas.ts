import { z } from "zod";
import {
  ASSET_STATUSES,
  ASSET_TYPES,
  DATA_CLASSIFICATIONS,
  EXPOSURES,
  MCP_TRANSPORTS,
  PERMISSIONS,
  ROLES,
  SECRETS_MANAGEMENT,
  type AssetStatus,
  type AssetType,
  type DataClassification,
  type Exposure,
  type McpTransport,
  type PermissionKey,
  type Role,
  type SecretsManagement,
} from "../domain/catalog.js";

const enumOf = <T extends string>(obj: Record<T, unknown>) => z.enum(Object.keys(obj) as [T, ...T[]]);

export const assetTypeSchema = enumOf<AssetType>(ASSET_TYPES);
export const assetStatusSchema = enumOf<AssetStatus>(ASSET_STATUSES);
export const roleSchema = enumOf<Role>(ROLES);

const stringList = z.array(z.string().trim().max(100)).max(50).default([]);
const optionalText = (max: number) => z.string().trim().max(max).default("");
const nullableId = z.number().int().positive().nullable().default(null);

export const assetBaseSchema = z.object({
  key: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z0-9-]*$/, "Nur Kleinbuchstaben, Ziffern und Bindestriche")
    .optional(),
  name: z.string().trim().min(2, "Name ist zu kurz").max(120),
  type: assetTypeSchema,
  description: optionalText(4000),
  purpose: optionalText(2000),
  ownerId: nullableId,
  teamId: nullableId,
  repositoryUrl: z.string().trim().max(500).nullable().default(null),
  environments: stringList,
  dataClassification: enumOf<DataClassification>(DATA_CLASSIFICATIONS).default("internal"),
  processesPersonalData: z.boolean().default(false),
  exposure: enumOf<Exposure>(EXPOSURES).default("local"),
  autonomyLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(1),
  humanInTheLoop: z.boolean().default(true),
  sandboxed: z.boolean().default(false),
  secretsManagement: enumOf<SecretsManagement>(SECRETS_MANAGEMENT).default("none"),
  models: stringList,
  capabilities: stringList,
  tags: stringList,
  permissions: z
    .array(z.object({ key: enumOf<PermissionKey>(PERMISSIONS), justification: optionalText(500) }))
    .max(40)
    .default([]),
  dependencies: z.array(z.number().int().positive()).max(100).default([]),
  mcpTransport: enumOf<McpTransport>(MCP_TRANSPORTS).nullable().default(null),
  mcpEndpoint: z.string().trim().max(1000).nullable().default(null),
  monthlyBudgetUsd: z.number().nonnegative().max(10_000_000).nullable().default(null),
  reviewIntervalDays: z.number().int().min(7).max(1095).nullable().default(null),
});

export const assetInputSchema = assetBaseSchema.superRefine((v, ctx) => {
  if (v.type === "mcp_server" && v.mcpEndpoint && v.mcpTransport && v.mcpTransport !== "stdio") {
    if (!/^(https?|\*):\/\//.test(v.mcpEndpoint)) {
      ctx.addIssue({ code: "custom", path: ["mcpEndpoint"], message: "Remote-MCP-Server benötigen eine URL (https://…)." });
    }
  }
});

export type AssetInputParsed = z.infer<typeof assetInputSchema>;

/** Lenient variant for live previews of half-filled forms. */
export const assetPreviewSchema = assetBaseSchema.extend({
  id: z.number().int().positive().optional(),
  name: z.string().max(120).default(""),
});

export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum im Format JJJJ-MM-TT");

export const usageRecordSchema = z.object({
  date: isoDay,
  assetKey: z.string().trim().max(60).optional(),
  assetId: z.number().int().positive().optional(),
  personEmail: z.string().trim().email().optional(),
  model: z.string().trim().min(1).max(100),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().optional(),
  dedupeKey: z.string().trim().max(200).optional(),
});
