"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useTheme } from "@/components/theme-provider";

const SIDEBAR_PERMISSION_CACHE_PREFIX = "pms.sidebar.allowed-pages.";
const SIDEBAR_PERMISSION_CACHE_TTL_MS = 60_000;
const EXACT_PERMISSION_PATHS = new Set(["/pms/inventory"]);

type SidebarPermissionCache = {
    uid: string;
    allowedPages: string[];
    exp: number;
};

const NAV_ITEMS = [
    {
        section: "Front Desk",
        items: [
            { href: "/pms", label: "Dashboard", icon: HomeIcon, exact: true },
            { href: "/pms/board", label: "Room Diary", icon: GridIcon },
            { href: "/pms/room-planner", label: "Room Planner", icon: GridIcon },
            { href: "/pms/calendar", label: "Calendar", icon: CalendarIcon },
            { href: "/pms/arrivals", label: "Arrivals", icon: ArrivalsIcon },
            { href: "/pms/mobile-checkin", label: "Mobile Check-in", icon: MobileCheckinIcon },
            { href: "/pms/inhouse", label: "In-House", icon: InHouseIcon },
            { href: "/pms/departures", label: "Departures", icon: DeparturesIcon },
            { href: "/pms/reservations", label: "Reservations", icon: ListIcon },
            { href: "/pms/groups", label: "Group Bookings", icon: GuestsIcon },
            { href: "/pms/logbook", label: "Logbook", icon: ListIcon },
            { href: "/pms/availability", label: "Availability", icon: CalendarIcon },
            { href: "/pms/vehicles", label: "Vehicle Registry", icon: TransportIcon },
        ]
    },
    {
        section: "Client Relations",
        items: [
            { href: "/pms/guests", label: "Guest Profiles", icon: GuestsIcon },
            { href: "/pms/guests/duplicates", label: "Merge Profiles", icon: MergeIcon }
        ]
    },
    {
        section: "Revenue",
        items: [
            { href: "/pms/rates", label: "Rate Grid", icon: RatesIcon },
            { href: "/pms/rates/plans", label: "Rate Plans", icon: RatesIcon },
            { href: "/pms/revenue", label: "Revenue Report", icon: RevenueIcon },
            { href: "/pms/revenue-daily", label: "Revenue Daily", icon: RevenueIcon },
            { href: "/pms/payments", label: "Payment Report", icon: PaymentIcon },
            { href: "/pms/payment-daily", label: "Payment Daily", icon: PaymentIcon },
            { href: "/pms/accounting", label: "Com and Tips", icon: PaymentIcon },
            { href: "/pms/tax-invoice", label: "Tax Invoice", icon: FileTextIcon },
            { href: "/pms/scb-transfers", label: "SCB Transfers", icon: ScbTransferIcon }
        ]
    },
    {
        section: "Point of Sale",
        items: [
            { href: "/pms/pos", label: "New Sale", icon: ShoppingCartIcon, exact: true },
            { href: "/pms/pos/orders", label: "Order History", icon: ReceiptIcon },
        ]
    },
    {
        section: "Inventory",
        items: [
            { href: "/pms/inventory", label: "Dashboard", icon: PackageIcon, exact: true },
            { href: "/pms/inventory/stock", label: "Stock Levels", icon: PackageIcon },
            { href: "/pms/inventory/snapshots", label: "Daily Snapshot", icon: PackageIcon },
            { href: "/pms/inventory/fo-prepare", label: "FO Prepare", icon: ShoppingCartIcon },
            { href: "/pms/inventory/amenity-audit", label: "Amenity Audit", icon: PackageIcon },
            { href: "/pms/inventory/transactions", label: "Transactions", icon: ListIcon },
        ]
    },
    {
        section: "Housekeeping",
        items: [
            { href: "/pms/housekeeping", label: "HK Dashboard", icon: HouseKeepingIcon, exact: true },
            { href: "/pms/housekeeping/extra-tasks", label: "Extra Tasks", icon: ListIcon },
            { href: "/pms/lost-found", label: "Lost & Found", icon: PackageIcon },
            { href: "/pms/linen", label: "Linen & Laundry", icon: PackageIcon },
            { href: "/maid", label: "Maid App", icon: BroomIcon },
        ]
    },
    {
        section: "Maintenance Hub",
        items: [
            { href: "/pms/maintenance", label: "Dashboard", icon: WrenchIcon, exact: true },
            { href: "/pms/maintenance/tasks", label: "Tasks", icon: ListIcon },
            { href: "/pms/maintenance/logs", label: "Logs", icon: ListIcon },
        ]
    },
    {
        section: "Transportation",
        items: [
            { href: "/pms/transportation", label: "Daily Board", icon: TransportIcon, exact: true },
            { href: "/pms/transportation/boats", label: "Boat Tickets", icon: BoatIcon },
            { href: "/pms/transportation/drivers", label: "Drivers & Vehicles", icon: DriverIcon },
            { href: "/pms/transportation/history", label: "Transfer History", icon: ListIcon },
        ]
    },
    {
        section: "Reports",
        items: [
            { href: "/pms/reports/tm30", label: "TM.30", icon: FileTextIcon },
            { href: "/pms/reports/rr3", label: "รร.3", icon: FileTextIcon },
        ]
    },
    {
        section: "Audit & Finance",
        items: [
            { href: "/pms/night-audit", label: "Night Audit", icon: MoonIcon },
            { href: "/pms/audit", label: "Audit Explorer", icon: ListIcon },
            { href: "/pms/audit/monthly", label: "Monthly Audit", icon: ListIcon },
            { href: "/pms/admin/corrections", label: "Admin Corrections", icon: WrenchIcon },
        ]
    },
    {
        section: "System",
        items: [
            { href: "/pms/settings", label: "Settings", icon: SettingsIcon },
            { href: "/pms/admin/settings", label: "System Settings", icon: SettingsIcon },
            { href: "/pms/setup/rooms", label: "Room Setup", icon: GridIcon },
            { href: "/pms/setup/rates", label: "Rate Setup", icon: RatesIcon },
            { href: "/pms/setup/guests", label: "Guest Setup", icon: GuestsIcon },
            { href: "/pms/setup/operations", label: "Operations Setup", icon: SettingsIcon },
            { href: "/pms/setup/room-blocks", label: "Room Blocks (OOO)", icon: HouseKeepingIcon },
            { href: "/pms/inventory/settings", label: "Inventory Settings", icon: PackageIcon },
            { href: "/pms/team", label: "Team & Shifts", icon: GuestsIcon },
            { href: "/pms/setup/permissions", label: "Permissions", icon: ShieldIcon },
            { href: "/pms/admin/backup-status", label: "Backup Status", icon: BackupIcon },
            { href: "/pms/training", label: "Training", icon: BookOpenIcon },
            { href: "/pms/admin/debug-logs", label: "Debug Logs", icon: BugIcon },
            { href: "/pms/setup/bug-reports", label: "Bug Reports", icon: BugIcon },
        ]
    }
];

function isAllowed(href: string, allowedPages: string[]): boolean {
    if (allowedPages.includes("*")) return true;
    return allowedPages.some((p) => {
        if (EXACT_PERMISSION_PATHS.has(p)) return href === p;
        return href === p || href.startsWith(`${p}/`);
    });
}

function normalizeAllowedPages(value: unknown): string[] {
    if (!Array.isArray(value)) return ["*"];
    const pages = value
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean);
    return pages.length > 0 ? Array.from(new Set(pages)) : ["*"];
}

function readSidebarPermissionCache(userId: string | null | undefined): string[] | null {
    if (typeof window === "undefined" || !userId) return null;
    try {
        const raw = window.localStorage.getItem(`${SIDEBAR_PERMISSION_CACHE_PREFIX}${userId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<SidebarPermissionCache>;
        if (String(parsed.uid ?? "") !== userId) return null;
        if (!Number.isFinite(parsed.exp) || Number(parsed.exp) <= Date.now()) return null;
        return normalizeAllowedPages(parsed.allowedPages);
    } catch {
        return null;
    }
}

function writeSidebarPermissionCache(userId: string, allowedPages: string[]): void {
    if (typeof window === "undefined" || !userId) return;
    try {
        const payload: SidebarPermissionCache = {
            uid: userId,
            allowedPages: normalizeAllowedPages(allowedPages),
            exp: Date.now() + SIDEBAR_PERMISSION_CACHE_TTL_MS,
        };
        window.localStorage.setItem(`${SIDEBAR_PERMISSION_CACHE_PREFIX}${userId}`, JSON.stringify(payload));
    } catch {
        // ignore cache write failures
    }
}

function clearSidebarPermissionCache(userId: string | null | undefined): void {
    if (typeof window === "undefined" || !userId) return;
    try {
        window.localStorage.removeItem(`${SIDEBAR_PERMISSION_CACHE_PREFIX}${userId}`);
    } catch {
        // ignore cache clear failures
    }
}

export default function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const [allowedPages, setAllowedPages] = useState<string[]>(["*"]);
    const { theme, setTheme } = useTheme();

    useEffect(() => {
        const supabase = createBrowserSupabaseClient();
        let cancelled = false;

        async function loadAllowedPages() {
            const { data: { session } } = await supabase.auth.getSession();
            const userId = session?.user?.id ?? null;
            if (!userId || cancelled) return;

            const cached = readSidebarPermissionCache(userId);
            if (cached) {
                setAllowedPages(cached);
                return;
            }

            const { data } = await supabase
                .from("profiles")
                .select("allowed_pages")
                .eq("user_id", userId)
                .single();
            if (cancelled) return;

            const nextAllowedPages = normalizeAllowedPages(data?.allowed_pages);
            setAllowedPages(nextAllowedPages);
            writeSidebarPermissionCache(userId, nextAllowedPages);
        }

        loadAllowedPages();
        return () => {
            cancelled = true;
        };
    }, []);

    async function handleLogout() {
        const supabase = createBrowserSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        clearSidebarPermissionCache(session?.user?.id ?? null);
        await supabase.auth.signOut();
        router.push("/login");
        router.refresh();
    }

    function isPathMatch(href: string, exact = false) {
        if (exact) return pathname === href;
        return pathname === href || pathname.startsWith(`${href}/`);
    }

    const activeHref =
        NAV_ITEMS.flatMap((group) => group.items)
            .filter((item) => isPathMatch(item.href, (item as { exact?: boolean }).exact))
            .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;

    return (
        <aside className="sidebar">
            {/* Logo */}
            <div className="sidebar-logo">
                <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white font-bold text-sm"
                    style={{ backgroundColor: "#1B4038" }}
                >P</span>
                <div className="sidebar-text">
                    <p className="text-sm font-bold leading-none" style={{ color: "var(--text-primary)" }}>OpenHotel</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>Hotel PMS</p>
                </div>
            </div>

            {/* Nav */}
            <nav className="sidebar-nav">
                {NAV_ITEMS.map((group) => {
                    const visibleItems = group.items.filter((item) => isAllowed(item.href, allowedPages));
                    if (visibleItems.length === 0) return null;
                    return (
                        <div key={group.section}>
                            <p className="nav-section-label sidebar-text">{group.section}</p>
                            {visibleItems.map((item) => (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`nav-item ${activeHref === item.href ? "active" : ""}`}
                                >
                                    <item.icon />
                                    <span className="sidebar-text">{item.label}</span>
                                </Link>
                            ))}
                        </div>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="border-t p-3 space-y-1" style={{ borderColor: "var(--border-subtle)", width: "var(--sidebar-expanded-w)" }}>
                <div className="flex items-center justify-between px-3 h-8">
                    <p className="text-[10px] sidebar-text" style={{ color: "var(--text-muted)" }}>v0.8 — Internal Test</p>
                    <button
                        onClick={() => {
                            if (theme === "light") setTheme("dark");
                            else if (theme === "dark") setTheme("high-contrast");
                            else setTheme("light");
                        }}
                        className="p-1 rounded-md transition-colors hover:bg-[var(--bg-surface-hover)] dark:hover:bg-slate-800 shrink-0"
                        style={{ color: "var(--text-muted)" }}
                        title={`Current Theme: ${theme}`}
                    >
                        {theme === "light" ? <SunIcon /> : theme === "dark" ? <MoonSmallIcon /> : <ShieldIcon className="w-3.5 h-3.5" />}
                    </button>
                </div>
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                >
                    <LogoutIcon />
                    <span className="sidebar-text">ออกจากระบบ</span>
                </button>
            </div>
        </aside>
    );
}

/* ── Icons (inline SVG to avoid extra deps) ─────── */
function HomeIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h4a1 1 0 001-1v-3h2v3a1 1 0 001 1h4a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
        </svg>
    );
}
function GridIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
    );
}
function ArrivalsIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 10a1 1 0 011-1h8.586L9.293 5.707a1 1 0 011.414-1.414l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L12.586 11H4a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
    );
}
function MobileCheckinIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M7 2a2 2 0 00-2 2v12a2 2 0 002 2h6a2 2 0 002-2V4a2 2 0 00-2-2H7zm3 14a1 1 0 100-2 1 1 0 000 2z" />
        </svg>
    );
}
function DeparturesIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M17 10a1 1 0 01-1 1H7.414l3.293 3.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 1.414L7.414 9H16a1 1 0 011 1z" clipRule="evenodd" />
        </svg>
    );
}
function ListIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
        </svg>
    );
}
function BroomIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm9.707 5.707a1 1 0 00-1.414-1.414L10 11.586l-1.293-1.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
    );
}
function CalendarIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
        </svg>
    );
}
function HouseKeepingIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
        </svg>
    );
}
function RatesIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
        </svg>
    );
}
function RevenueIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
    );
}
function SettingsIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
    );
}
function PaymentIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
            <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
        </svg>
    );
}
function ScbTransferIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 01.707 1.707L13.414 9l3.293 3.293A1 1 0 0116 14H4a1 1 0 01-.707-1.707L6.586 9 3.293 5.707A1 1 0 013 5zm3.414 4L4.414 7h11.172l-2 2H6.414zM4.414 13h11.172l-2-2H6.414l-2 2z" clipRule="evenodd" />
        </svg>
    );
}
function MergeIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6.293 3.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3A1 1 0 016.293 9.293L7.586 8H4a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 00-1.414 0z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M13.707 10.707a1 1 0 00-1.414 0L11 12a1 1 0 101.414 1.414L13.414 12H16a1 1 0 110 2h-2.586l1.293 1.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 1.414L13.414 10H16a1 1 0 010 2h-2.586l.293-.293z" clipRule="evenodd" />
        </svg>
    );
}

function InHouseIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
        </svg>
    );
}
function WrenchIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
        </svg>
    );
}
function GuestsIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
    );
}
function ShoppingCartIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
        </svg>
    );
}
function ReceiptIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
        </svg>
    );
}
function PackageIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 2l6 3v4.5a6.5 6.5 0 01-6 6.48A6.5 6.5 0 014 9.5V5l6-3zm0 2.236L6 6.118v3.382a4.5 4.5 0 004 4.464V4.236zm2 7.728a4.5 4.5 0 002-3.464V6.118L10 4.236v7.728z" clipRule="evenodd" />
        </svg>
    );
}
function TagIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
    );
}
function TransportIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
            <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0h2.1a2.5 2.5 0 014.9 0H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-3-3A1 1 0 0014 6h-1V5a1 1 0 00-1-1H3zm10 3h1.586L16 8.414V11h-3V7z" />
        </svg>
    );
}
function BoatIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M3.196 12.87l-.825.483a.75.75 0 000 1.294l7.25 4.25a.75.75 0 00.758 0l7.25-4.25a.75.75 0 000-1.294l-.825-.484-5.666 3.322a2.25 2.25 0 01-2.276 0L3.196 12.87z" />
            <path d="M3.196 8.87l-.825.483a.75.75 0 000 1.294l7.25 4.25a.75.75 0 00.758 0l7.25-4.25a.75.75 0 000-1.294l-.825-.484-5.666 3.322a2.25 2.25 0 01-2.276 0L3.196 8.87z" />
            <path d="M10.38 1.103a.75.75 0 00-.76 0l-7.25 4.25a.75.75 0 000 1.294l7.25 4.25a.75.75 0 00.76 0l7.25-4.25a.75.75 0 000-1.294l-7.25-4.25z" />
        </svg>
    );
}
function DriverIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
        </svg>
    );
}
function MoonIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
    );
}
function ShieldIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor" className={className || ""}>
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
    );
}
function BugIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
    );
}
function MoonSmallIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
        </svg>
    );
}
function SunIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
        </svg>
    );
}
function LogoutIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
        </svg>
    );
}
function BookOpenIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
        </svg>
    );
}

function FileTextIcon({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" className={className || ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
        </svg>
    );
}

function BackupIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M2 5a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm14 1a1 1 0 100-2 1 1 0 000 2zM2 13a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2zm14 1a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
    );
}
