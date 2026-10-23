import { DATA_CLASSIFICATIONS, EXPOSURES, PERMISSIONS, type PermissionKey, type RiskLevel } from "./catalog.js";
import type { RiskInput } from "./types.js";

export interface RiskFactor {
  label: string;
  points: number;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

const EXPOSURE_POINTS = { local: 0, internal: 5, partner: 15, public: 25 } as const;
const CLASSIFICATION_POINTS = { public: 0, internal: 5, confidential: 15, strictly_confidential: 25 } as const;
const AUTONOMY_POINTS = { 0: 0, 1: 4, 2: 12, 3: 20 } as const;

/** Combinations that are more dangerous together than on their own. */
const TOXIC_COMBINATIONS: { all: PermissionKey[]; anyOf: PermissionKey[]; label: string; points: number }[] = [
  {
    all: ["secrets.read"],
    anyOf: ["net.outbound", "external.api"],
    label: "Secrets-Zugriff kombiniert mit Internetzugang (Exfiltrationsrisiko)",
    points: 12,
  },
  {
    all: ["pii.access"],
    anyOf: ["net.outbound", "external.api", "email.send"],
    label: "Personenbezogene Daten kombiniert mit Datenabfluss-Kanal",
    points: 10,
  },
  {
    all: ["shell.exec"],
    anyOf: ["net.outbound"],
    label: "Shell-Ausführung mit Internetzugang (Prompt-Injection → Remote-Ausführung)",
    points: 8,
  },
];

export function riskLevelForScore(score: number): RiskLevel {
  if (score >= 70) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high", "critical"];
export function riskAtLeast(level: RiskLevel, min: RiskLevel): boolean {
  return RISK_ORDER.indexOf(level) >= RISK_ORDER.indexOf(min);
}

export function hasWritePermission(permissions: PermissionKey[]): boolean {
  return permissions.some((p) => PERMISSIONS[p]?.writes);
}

/**
 * Transparent, additive risk model (0–100). Every point is attributed to a factor so that
 * owners understand *why* an asset is rated the way it is and what to change to lower it.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const factors: RiskFactor[] = [];
  const add = (label: string, points: number) => {
    if (points > 0) factors.push({ label, points });
  };

  add(`Erreichbarkeit: ${EXPOSURES[input.exposure]}`, EXPOSURE_POINTS[input.exposure] ?? 0);
  add(
    `Datenklassifizierung: ${DATA_CLASSIFICATIONS[input.dataClassification]}`,
    CLASSIFICATION_POINTS[input.dataClassification] ?? 0,
  );
  if (input.processesPersonalData) add("Verarbeitet personenbezogene Daten (DSGVO)", 10);

  const autonomy = AUTONOMY_POINTS[input.autonomyLevel] ?? 0;
  add(`Autonomiestufe L${input.autonomyLevel}`, autonomy);

  const perms = [...new Set(input.permissions)].filter((p) => p in PERMISSIONS);
  const permissionWeight = perms.reduce((sum, p) => sum + PERMISSIONS[p].weight, 0);
  add(`Berechtigungen (${perms.length}, Gewicht ${permissionWeight})`, Math.min(30, permissionWeight * 2));

  if (!input.humanInTheLoop && hasWritePermission(perms)) {
    add("Schreibende Aktionen ohne menschliche Bestätigung", 10);
  }
  if (perms.includes("shell.exec") && !input.sandboxed) {
    add("Shell-Ausführung ohne Sandbox", 6);
  }
  if (input.secretsManagement === "plaintext") add("Secrets im Klartext", 12);
  else if (input.secretsManagement === "env" && (input.exposure === "public" || input.exposure === "partner")) {
    add("Secrets als Umgebungsvariablen bei externer Erreichbarkeit", 4);
  }

  for (const combo of TOXIC_COMBINATIONS) {
    if (combo.all.every((p) => perms.includes(p)) && combo.anyOf.some((p) => perms.includes(p))) {
      add(combo.label, combo.points);
    }
  }

  const score = Math.min(
    100,
    factors.reduce((s, f) => s + f.points, 0),
  );
  return { score, level: riskLevelForScore(score), factors: factors.sort((a, b) => b.points - a.points) };
}
