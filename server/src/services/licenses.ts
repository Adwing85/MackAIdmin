import { all, type DB } from "../db/database.js";
import { getGovernance } from "./settings.js";

export interface LicenseTypeView {
  id: number;
  name: string;
  vendor: string;
  monthlyPriceUsd: number;
  seatsPurchased: number;
  includesClaudeCode: boolean;
  notes: string;
  assigned: number;
  inactive: number;
  monthlyCostUsd: number;
}

export interface AssignmentView {
  id: number;
  licenseTypeId: number;
  licenseName: string;
  personId: number;
  personName: string;
  personEmail: string;
  personActive: boolean;
  teamName: string | null;
  assignedAt: string;
  lastActiveAt: string | null;
  daysSinceActive: number;
  inactive: boolean;
}

export function licenseOverview(db: DB, now = new Date()) {
  const { inactiveSeatDays } = getGovernance(db);
  const lastUsage = new Map(
    all<{ person_id: number; d: string }>(
      db,
      "SELECT person_id, MAX(date) AS d FROM usage_records WHERE person_id IS NOT NULL GROUP BY person_id",
    ).map((r) => [r.person_id, r.d]),
  );

  const assignments: AssignmentView[] = all<Record<string, unknown>>(
    db,
    `SELECT la.*, lt.name AS license_name, p.name AS person_name, p.email AS person_email, p.active AS person_active,
            t.name AS team_name
     FROM license_assignments la
     JOIN license_types lt ON lt.id = la.license_type_id
     JOIN people p ON p.id = la.person_id
     LEFT JOIN teams t ON t.id = p.team_id
     WHERE la.revoked_at IS NULL
     ORDER BY p.name COLLATE NOCASE`,
  ).map((r) => {
    const candidates = [r.last_active_at as string | null, lastUsage.get(r.person_id as number) ?? null].filter(
      (x): x is string => !!x,
    );
    const lastActiveAt = candidates.sort().at(-1) ?? null;
    const reference = new Date(lastActiveAt ?? (r.assigned_at as string));
    const daysSinceActive = Math.max(0, Math.floor((now.getTime() - reference.getTime()) / 86_400_000));
    return {
      id: r.id as number,
      licenseTypeId: r.license_type_id as number,
      licenseName: r.license_name as string,
      personId: r.person_id as number,
      personName: r.person_name as string,
      personEmail: r.person_email as string,
      personActive: !!r.person_active,
      teamName: r.team_name as string | null,
      assignedAt: r.assigned_at as string,
      lastActiveAt,
      daysSinceActive,
      // Seats of people who left the company are always reclaimable.
      inactive: daysSinceActive > inactiveSeatDays || !r.person_active,
    };
  });

  const types: LicenseTypeView[] = all<Record<string, unknown>>(db, "SELECT * FROM license_types ORDER BY name").map((r) => {
    const mine = assignments.filter((a) => a.licenseTypeId === r.id);
    const purchased = r.seats_purchased as number;
    const price = r.monthly_price_usd as number;
    return {
      id: r.id as number,
      name: r.name as string,
      vendor: r.vendor as string,
      monthlyPriceUsd: price,
      seatsPurchased: purchased,
      includesClaudeCode: !!r.includes_claude_code,
      notes: r.notes as string,
      assigned: mine.length,
      inactive: mine.filter((a) => a.inactive).length,
      monthlyCostUsd: Math.max(purchased, mine.length) * price,
    };
  });

  const priceOf = new Map(types.map((t) => [t.id, t.monthlyPriceUsd]));
  const unassignedCost = types.reduce((s, t) => s + Math.max(0, t.seatsPurchased - t.assigned) * t.monthlyPriceUsd, 0);
  const inactiveCost = assignments.filter((a) => a.inactive).reduce((s, a) => s + (priceOf.get(a.licenseTypeId) ?? 0), 0);

  return {
    inactiveSeatDays,
    types,
    assignments,
    kpis: {
      seatsPurchased: types.reduce((s, t) => s + t.seatsPurchased, 0),
      seatsAssigned: assignments.length,
      unassignedSeats: types.reduce((s, t) => s + Math.max(0, t.seatsPurchased - t.assigned), 0),
      inactiveSeats: assignments.filter((a) => a.inactive).length,
      monthlyCostUsd: types.reduce((s, t) => s + t.monthlyCostUsd, 0),
      potentialSavingsUsd: unassignedCost + inactiveCost,
    },
  };
}
