export type AlertSeverity = "info" | "warning" | "critical";
export type AlertDisplaySurface =
  | "arrivals"
  | "room_diary"
  | "calendar"
  | "reservation"
  | "inhouse"
  | "room_drawer"
  | "hk_dashboard";

export type EffectiveReservationAlert = {
  id: string;
  reservation_id: string;
  alert_code: string | null;
  alert_template_id: number | null;
  template_code: string | null;
  template_name: string | null;
  category: string | null;
  message: string;
  severity: AlertSeverity;
  display_surfaces: AlertDisplaySurface[];
  is_dismissed: boolean;
  created_at: string | null;
  created_by: string | null;
  note: string | null;
  custom_message: string | null;
  icon: string | null;
  auto_on_co: boolean;
  is_legacy: boolean;
};

export type AlertTemplateRow = {
  id: number;
  code: string;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  display_surfaces?: AlertDisplaySurface[] | string[] | null;
  severity?: AlertSeverity | string | null;
  icon?: string | null;
};

const SURFACE_VALUES: AlertDisplaySurface[] = [
  "arrivals",
  "room_diary",
  "calendar",
  "reservation",
  "inhouse",
  "room_drawer",
  "hk_dashboard",
];

export function normalizeAlertCodeKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeAlertSeverity(value: unknown): AlertSeverity {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "warning" || normalized === "critical") return normalized;
  return "info";
}

export function resolveEffectiveAlertSeverity(rowSeverity: unknown, templateSeverity: unknown): AlertSeverity {
  const normalizedRowSeverity = normalizeAlertSeverity(rowSeverity);
  const normalizedTemplateSeverity = normalizeAlertSeverity(templateSeverity);
  return getAlertSeverityRank(normalizedTemplateSeverity) > getAlertSeverityRank(normalizedRowSeverity)
    ? normalizedTemplateSeverity
    : normalizedRowSeverity;
}

export function normalizeDisplaySurfaces(value: unknown, fallback: AlertDisplaySurface[] = ["reservation"]): AlertDisplaySurface[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .map((item) => String(item ?? "").trim())
    .filter((item): item is AlertDisplaySurface => SURFACE_VALUES.includes(item as AlertDisplaySurface));
  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

export function defaultDisplaySurfacesFromLegacy(params: {
  alertCode?: string | null;
  dept?: string | null;
  autoOnCheckout?: boolean | null;
}): AlertDisplaySurface[] {
  const code = String(params.alertCode ?? "").trim().toUpperCase();
  const dept = String(params.dept ?? "").trim().toUpperCase();
  const autoOnCheckout = params.autoOnCheckout === true;

  if (code === "BOAT" || code === "CAR") {
    return ["arrivals", "room_drawer", "reservation", "calendar", "room_diary"];
  }
  if (autoOnCheckout) {
    return ["reservation", "room_drawer", "inhouse"];
  }
  if (dept === "HK") {
    return ["reservation", "room_drawer", "inhouse", "room_diary", "calendar", "hk_dashboard"];
  }
  return ["reservation", "room_drawer", "arrivals", "inhouse", "room_diary", "calendar"];
}

export function resolveAlertMessage(row: any): string {
  const customMessage = String(row?.custom_message ?? "").trim();
  if (customMessage) return customMessage;

  const note = String(row?.note ?? "").trim();
  const templateName = String(row?.alert_templates?.name ?? "").trim();
  const templateDescription = String(row?.alert_templates?.description ?? "").trim();
  const legacyDescription = String(row?.alert_codes?.description ?? "").trim();

  if (templateName && note) return `${templateName} - ${note}`;
  if (templateName && templateDescription) return `${templateName} - ${templateDescription}`;
  if (templateName) return templateName;
  if (legacyDescription && note) return `${legacyDescription} - ${note}`;
  if (legacyDescription) return legacyDescription;
  if (row?.alert_code && note) return `${String(row.alert_code)} - ${note}`;
  if (note) return note;
  if (row?.alert_code) return String(row.alert_code);
  return "Alert";
}

export function mapEffectiveReservationAlert(row: any): EffectiveReservationAlert {
  const template = Array.isArray(row?.alert_templates) ? row.alert_templates[0] : row?.alert_templates;
  const legacyCode = Array.isArray(row?.alert_codes) ? row.alert_codes[0] : row?.alert_codes;
  const surfaces = normalizeDisplaySurfaces(
    row?.display_surfaces ?? template?.display_surfaces,
    defaultDisplaySurfacesFromLegacy({
      alertCode: row?.alert_code ?? template?.code ?? legacyCode?.code ?? null,
      dept: template?.category === "housekeeping" ? "HK" : legacyCode?.dept ?? null,
      autoOnCheckout: legacyCode?.auto_on_co ?? false,
    })
  );

  return {
    id: String(row?.id ?? ""),
    reservation_id: String(row?.reservation_id ?? ""),
    alert_code: row?.alert_code ? String(row.alert_code) : null,
    alert_template_id: row?.alert_template_id == null ? null : Number(row.alert_template_id),
    template_code: template?.code ? String(template.code) : null,
    template_name: template?.name ? String(template.name) : null,
    category: template?.category ? String(template.category) : null,
    message: resolveAlertMessage(row),
    severity: resolveEffectiveAlertSeverity(row?.severity, template?.severity),
    display_surfaces: surfaces,
    is_dismissed: Boolean(row?.is_dismissed),
    created_at: row?.created_at ? String(row.created_at) : null,
    created_by: row?.created_by ? String(row.created_by) : null,
    note: row?.note ? String(row.note) : null,
    custom_message: row?.custom_message ? String(row.custom_message) : null,
    icon: template?.icon ? String(template.icon) : legacyCode?.icon ? String(legacyCode.icon) : null,
    auto_on_co: Boolean(legacyCode?.auto_on_co),
    is_legacy: row?.alert_template_id == null,
  };
}

export function attachTemplateFallback<T extends {
  alert_template_id?: number | null;
  alert_code?: string | null;
  alert_templates?: any;
}>(rows: T[], templateMap: Map<string, AlertTemplateRow>) {
  return rows.map((row) => {
    if (row?.alert_template_id || row?.alert_templates) return row;
    const template = templateMap.get(normalizeAlertCodeKey(row?.alert_code));
    if (!template) return row;
    return {
      ...row,
      alert_template_id: template.id,
      alert_templates: template,
    };
  });
}

export function filterAlertsForSurface(alerts: EffectiveReservationAlert[], surface: AlertDisplaySurface, options?: {
  includeDismissed?: boolean;
}) {
  const includeDismissed = options?.includeDismissed === true;
  return alerts.filter((alert) => {
    if (!includeDismissed && alert.is_dismissed) return false;
    return alert.display_surfaces.includes(surface);
  });
}

export function getAlertSeverityRank(severity: AlertSeverity): number {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

export function summarizeAlerts(alerts: EffectiveReservationAlert[]) {
  if (!alerts.length) {
    return {
      count: 0,
      firstMessage: null as string | null,
      highestSeverity: null as AlertSeverity | null,
    };
  }

  const highestSeverity = alerts.reduce<AlertSeverity>((current, alert) => {
    return getAlertSeverityRank(alert.severity) > getAlertSeverityRank(current)
      ? alert.severity
      : current;
  }, alerts[0].severity);

  return {
    count: alerts.length,
    firstMessage: alerts[0]?.message ?? null,
    highestSeverity,
  };
}
