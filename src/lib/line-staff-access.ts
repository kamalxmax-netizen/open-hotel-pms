type RelationValue = Record<string, unknown> | Array<Record<string, unknown>> | null | undefined;

export type LineStaffAccess = {
  isBound: boolean;
  isFrontdeskOnly: boolean;
  departmentCode: string | null;
  role: string | null;
};

function firstRelation(value: RelationValue): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

export function classifyLineStaffAccess(row: RelationValue): LineStaffAccess {
  const staff = firstRelation(row);
  const department = firstRelation(staff?.department as RelationValue);
  const profile = firstRelation(staff?.profiles as RelationValue);
  const departmentCode = normalizeText(department?.code)?.toUpperCase() ?? null;
  const role = normalizeText(profile?.role)?.toLowerCase() ?? null;
  const isBound = Boolean(staff?.id);

  return {
    isBound,
    isFrontdeskOnly: isBound && (role === "frontdesk" || (!role && departmentCode === "FO")),
    departmentCode,
    role,
  };
}

export function canUseGeneralLineCommand(access: LineStaffAccess): boolean {
  return access.isBound && !access.isFrontdeskOnly;
}
