"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LineBindCard } from "./LineBindCard"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

type DepartmentOption = {
    id: string
    code: string
    name: string
}

type StaffPublic = {
    id: string
    employee_code: string
    display_name: string
    nickname: string | null
    department_id: string | null
    is_active: boolean
    hk_lane_enabled: boolean
    hk_lane_order: number
    department: { code: string; name: string } | null
    source?: "staff" | "lane"
    can_bind_line?: boolean
}

type EditStaffDraft = {
    display_name: string
    nickname: string
    department_id: string
    is_active: boolean
    hk_lane_enabled: boolean
    hk_lane_order: number
}

type EditSyncStats = {
    daily_plans?: number
    housekeeping_tasks?: number
    extra_task_assignments?: number
}

type CreateStaffDraft = {
    display_name: string
    nickname: string
    department_code: string
    is_active: boolean
    hk_lane_enabled: boolean
    hk_lane_order: number
}

type InviteStaffDraft = {
    email: string
    display_name: string
    nickname: string
    role: "admin" | "frontdesk" | "maid" | "supervisor"
    department_code: string
    is_active: boolean
    hk_lane_enabled: boolean
    hk_lane_order: number
}

const ROLE_OPTIONS: Array<{ value: InviteStaffDraft["role"]; label: string }> = [
    { value: "frontdesk", label: "Front Desk" },
    { value: "maid", label: "Maid" },
    { value: "supervisor", label: "Supervisor" },
    { value: "admin", label: "Admin" },
]

function toInitialDraft(staff: StaffPublic): EditStaffDraft {
    return {
        display_name: staff.display_name ?? "",
        nickname: staff.nickname ?? "",
        department_id: staff.department_id ?? "",
        is_active: staff.is_active,
        hk_lane_enabled: staff.hk_lane_enabled,
        hk_lane_order: Number(staff.hk_lane_order ?? 100),
    }
}

const DEFAULT_HK_STAFF_NAMES = ["Jan", "Tan", "Others"] as const

function buildFallbackStaffList(): StaffPublic[] {
    return DEFAULT_HK_STAFF_NAMES.map((name, idx) => ({
        id: `fallback-${idx + 1}`,
        employee_code: `LANE-00${idx + 1}`,
        display_name: name,
        nickname: null,
        department_id: null,
        is_active: true,
        hk_lane_enabled: true,
        hk_lane_order: idx + 1,
        department: { code: "HK", name: "Housekeeping" },
        source: "lane",
        can_bind_line: false,
    }))
}

export function StaffListTab() {
    const [staffList, setStaffList] = useState<StaffPublic[]>([])
    const [departments, setDepartments] = useState<DepartmentOption[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [bindingStaffId, setBindingStaffId] = useState<string | null>(null)

    const [editingStaff, setEditingStaff] = useState<StaffPublic | null>(null)
    const [editDraft, setEditDraft] = useState<EditStaffDraft | null>(null)
    const [savingEdit, setSavingEdit] = useState(false)
    const [showEditValidation, setShowEditValidation] = useState(false)

    const [creatingStaff, setCreatingStaff] = useState(false)
    const [createDraft, setCreateDraft] = useState<CreateStaffDraft>({
        display_name: "",
        nickname: "",
        department_code: "HK",
        is_active: true,
        hk_lane_enabled: true,
        hk_lane_order: 100,
    })
    const [savingCreate, setSavingCreate] = useState(false)
    const [showCreateValidation, setShowCreateValidation] = useState(false)
    const [invitingStaff, setInvitingStaff] = useState(false)
    const [savingInvite, setSavingInvite] = useState(false)
    const [showInviteValidation, setShowInviteValidation] = useState(false)
    const [inviteDraft, setInviteDraft] = useState<InviteStaffDraft>({
        email: "",
        display_name: "",
        nickname: "",
        role: "frontdesk",
        department_code: "FO",
        is_active: true,
        hk_lane_enabled: false,
        hk_lane_order: 100,
    })

    const getAuthHeader = useCallback(async (): Promise<Record<string, string>> => {
        const supabase = createBrowserSupabaseClient()
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        return token ? { Authorization: `Bearer ${token}` } : {}
    }, [])

    const fetchStaff = useCallback(async () => {
        const fallback = buildFallbackStaffList()
        try {
            setLoading(true)
            setError(null)
            const authHeader = await getAuthHeader()
            const res = await fetch("/api/staff?is_active=true", {
                headers: authHeader
            })
            const data = await res.json()
            if (data.success) {
                const rows = Array.isArray(data.data) ? data.data : []
                setStaffList(rows.length > 0 ? rows : fallback)
                if (rows.length === 0) {
                    setError("No staff found in database. Showing default HK lanes (Jan/Tan/Others).")
                }
            } else {
                setError(data.error || "Failed to load staff")
                setStaffList((prev) => prev.length > 0 ? prev : fallback)
            }
        } catch {
            setError("Network error fetching staff")
            setStaffList((prev) => prev.length > 0 ? prev : fallback)
        } finally {
            setLoading(false)
        }
    }, [getAuthHeader])

    const fetchDepartments = useCallback(async () => {
        try {
            const authHeader = await getAuthHeader()
            const res = await fetch("/api/departments", { headers: authHeader })
            const data = await res.json()
            if (data.success) {
                setDepartments(Array.isArray(data.data) ? data.data : [])
            }
        } catch {
            // no-op
        }
    }, [getAuthHeader])

    useEffect(() => {
        void fetchStaff()
        void fetchDepartments()
    }, [fetchStaff, fetchDepartments])

    const laneCount = useMemo(
        () => staffList.filter((staff) => staff.hk_lane_enabled && staff.is_active).length,
        [staffList]
    )

    const openEdit = (staff: StaffPublic) => {
        setEditingStaff(staff)
        setEditDraft(toInitialDraft(staff))
        setShowEditValidation(false)
    }

    const closeEdit = () => {
        if (savingEdit) return
        setEditingStaff(null)
        setEditDraft(null)
        setShowEditValidation(false)
    }

    const openCreate = () => {
        setCreateDraft({
            display_name: "",
            nickname: "",
            department_code: departments.find((d) => d.code === "HK")?.code ?? "HK",
            is_active: true,
            hk_lane_enabled: true,
            hk_lane_order: 100,
        })
        setShowCreateValidation(false)
        setCreatingStaff(true)
    }

    const closeCreate = () => {
        if (savingCreate) return
        setCreatingStaff(false)
        setShowCreateValidation(false)
    }

    const openInvite = () => {
        setInviteDraft({
            email: "",
            display_name: "",
            nickname: "",
            role: "frontdesk",
            department_code: departments.find((d) => d.code === "FO")?.code ?? "FO",
            is_active: true,
            hk_lane_enabled: false,
            hk_lane_order: 100,
        })
        setShowInviteValidation(false)
        setInvitingStaff(true)
    }

    const closeInvite = () => {
        if (savingInvite) return
        setInvitingStaff(false)
        setShowInviteValidation(false)
    }

    const saveEdit = async () => {
        if (!editingStaff || !editDraft) return
        setShowEditValidation(true)
        if (!editDraft.display_name.trim()) {
            return
        }
        if (!Number.isFinite(editDraft.hk_lane_order) || editDraft.hk_lane_order < 1 || editDraft.hk_lane_order > 999) {
            return
        }

        try {
            setSavingEdit(true)
            const authHeader = await getAuthHeader()
            const res = await fetch(`/api/staff/${editingStaff.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeader,
                },
                body: JSON.stringify({
                    display_name: editDraft.display_name.trim(),
                    nickname: editDraft.nickname.trim() || null,
                    department_id: editDraft.department_id || null,
                    is_active: editDraft.is_active,
                    hk_lane_enabled: editDraft.hk_lane_enabled,
                    hk_lane_order: Math.trunc(editDraft.hk_lane_order),
                }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to save staff profile")
            }

            const sync = (data.sync ?? {}) as EditSyncStats
            const totalSynced =
                Number(sync.daily_plans ?? 0) +
                Number(sync.housekeeping_tasks ?? 0) +
                Number(sync.extra_task_assignments ?? 0)

            if (totalSynced > 0) {
                alert(
                    `Saved. HK assignments synced: Daily Plans ${sync.daily_plans ?? 0}, HK Tasks ${sync.housekeeping_tasks ?? 0}, Extra Tasks ${sync.extra_task_assignments ?? 0}`
                )
            }

            await fetchStaff()
            closeEdit()
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to save")
        } finally {
            setSavingEdit(false)
        }
    }

    const saveCreate = async () => {
        setShowCreateValidation(true)
        if (!createDraft.display_name.trim()) {
            return
        }
        if (!Number.isFinite(createDraft.hk_lane_order) || createDraft.hk_lane_order < 1 || createDraft.hk_lane_order > 999) {
            return
        }

        try {
            setSavingCreate(true)
            const authHeader = await getAuthHeader()
            const res = await fetch("/api/staff", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeader,
                },
                body: JSON.stringify({
                    display_name: createDraft.display_name.trim(),
                    nickname: createDraft.nickname.trim() || null,
                    department_code: createDraft.department_code || "HK",
                    is_active: createDraft.is_active,
                    hk_lane_enabled: createDraft.hk_lane_enabled,
                    hk_lane_order: Math.trunc(createDraft.hk_lane_order),
                }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to create lane")
            }
            await fetchStaff()
            closeCreate()
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to create lane")
        } finally {
            setSavingCreate(false)
        }
    }

    const saveInvite = async () => {
        setShowInviteValidation(true)
        if (!inviteDraft.display_name.trim()) {
            return
        }
        if (!inviteDraft.email.trim()) {
            return
        }
        if (!Number.isFinite(inviteDraft.hk_lane_order) || inviteDraft.hk_lane_order < 1 || inviteDraft.hk_lane_order > 999) {
            return
        }

        try {
            setSavingInvite(true)
            const authHeader = await getAuthHeader()
            const res = await fetch("/api/staff/invite", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeader,
                },
                body: JSON.stringify({
                    email: inviteDraft.email.trim().toLowerCase(),
                    display_name: inviteDraft.display_name.trim(),
                    nickname: inviteDraft.nickname.trim() || null,
                    role: inviteDraft.role,
                    department_code: inviteDraft.department_code,
                    is_active: inviteDraft.is_active,
                    hk_lane_enabled: inviteDraft.hk_lane_enabled,
                    hk_lane_order: Math.trunc(inviteDraft.hk_lane_order),
                }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Failed to invite staff")
            }
            await fetchStaff()
            closeInvite()
        } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to invite staff")
        } finally {
            setSavingInvite(false)
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            {error && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {error}
                </div>
            )}
            <div className="flex justify-between items-center mt-2">
                <div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)]">Staff Members</h2>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                        HK Lane enabled: <span className="font-semibold text-[var(--text-secondary)]">{laneCount}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button size="sm" onClick={openInvite}>
                        + Invite Staff
                    </Button>
                    <Button variant="outline" size="sm" onClick={openCreate}>
                        + New Lane
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void fetchStaff()}>
                        ↻ Refresh
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-40 bg-[var(--bg-muted)] animate-pulse rounded-lg border"></div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {staffList.map((staff) => (
                        <Card key={staff.id} className="p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start gap-2">
                                <div>
                                    <h3 className="font-bold text-[var(--text-primary)] text-base">
                                        {staff.display_name} {staff.nickname && <span className="text-[var(--text-muted)] font-normal">({staff.nickname})</span>}
                                    </h3>
                                    <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">{staff.employee_code}</p>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    {staff.department ? (
                                        <Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-wider rounded-sm">
                                            {staff.department.code}
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider rounded-sm text-[var(--text-muted)]">
                                            N/A
                                        </Badge>
                                    )}
                                    {staff.hk_lane_enabled ? (
                                        <Badge className="text-[10px] rounded-sm bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                                            HK Lane #{staff.hk_lane_order}
                                        </Badge>
                                    ) : (
                                        <Badge variant="outline" className="text-[10px] rounded-sm text-[var(--text-muted)]">
                                            Not in lane
                                        </Badge>
                                    )}
                                    <Badge
                                        variant="outline"
                                        className={`text-[10px] rounded-sm ${
                                            staff.source === "lane"
                                                ? "text-indigo-500 border-indigo-200"
                                                : "text-sky-600 border-sky-200"
                                        }`}
                                    >
                                        {staff.source === "lane" ? "Lane" : "Staff"}
                                    </Badge>
                                </div>
                            </div>

                            <div className="mt-auto pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => openEdit(staff)}
                                >
                                    Edit Staff
                                </Button>
                                {staff.can_bind_line !== false ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="w-full text-[#00B900] border-[#00B900]/30 hover:bg-[#00B900] hover:text-white transition-colors"
                                        onClick={() => setBindingStaffId(staff.id)}
                                    >
                                        🔗 Bind LINE Account
                                    </Button>
                                ) : (
                                    <Button size="sm" variant="outline" className="w-full" disabled>
                                        No LINE bind (Lane)
                                    </Button>
                                )}
                            </div>
                        </Card>
                    ))}
                    {staffList.length === 0 && (
                        <div className="col-span-full text-center py-16 px-4 bg-[var(--bg-body)] rounded-xl border border-dashed text-[var(--text-secondary)]">
                            <p className="text-4xl mb-3">👥</p>
                            <p className="font-medium text-[var(--text-table-cell)]">No staff members found.</p>
                            <p className="text-sm">Check profiles/users setup, then refresh to sync to Staff Directory.</p>
                        </div>
                    )}
                </div>
            )}

            {bindingStaffId && (
                <LineBindCard
                    staffId={bindingStaffId}
                    onClose={() => setBindingStaffId(null)}
                />
            )}

            {creatingStaff && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-lg p-5 space-y-4">
                        <div>
                            <h3 className="text-lg font-bold text-[var(--text-primary)]">Create Manual Lane</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                Add lane-only name for Housekeeping timeline (no login account, no LINE bind).
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="text-sm flex flex-col gap-1">
                                <span className="text-[var(--text-secondary)]">Display Name</span>
                                <input
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={createDraft.display_name}
                                    onChange={(e) => setCreateDraft((prev) => ({ ...prev, display_name: e.target.value }))}
                                    required
                                    aria-invalid={showCreateValidation && !createDraft.display_name.trim()}
                                />
                                {showCreateValidation && !createDraft.display_name.trim() && (
                                    <span className="text-xs text-rose-600">Display name is required.</span>
                                )}
                            </label>
                            <label className="text-sm flex flex-col gap-1">
                                <span className="text-[var(--text-secondary)]">Nickname</span>
                                <input
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={createDraft.nickname}
                                    onChange={(e) => setCreateDraft((prev) => ({ ...prev, nickname: e.target.value }))}
                                />
                            </label>
                            <label className="text-sm flex flex-col gap-1 md:col-span-2">
                                <span className="text-[var(--text-secondary)]">Department</span>
                                <select
                                    className="h-9 rounded-md border px-3 text-sm bg-[var(--bg-surface)]"
                                    value={createDraft.department_code}
                                    onChange={(e) => setCreateDraft((prev) => ({ ...prev, department_code: e.target.value }))}
                                >
                                    {departments.map((department) => (
                                        <option key={department.id} value={department.code}>
                                            {department.code} - {department.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="text-sm flex items-center gap-2 md:col-span-2">
                                <input
                                    type="checkbox"
                                    checked={createDraft.is_active}
                                    onChange={(e) => setCreateDraft((prev) => ({ ...prev, is_active: e.target.checked }))}
                                />
                                <span className="text-[var(--text-secondary)]">Active lane</span>
                            </label>
                            <label className="text-sm flex items-center gap-2 md:col-span-2">
                                <input
                                    type="checkbox"
                                    checked={createDraft.hk_lane_enabled}
                                    onChange={(e) => setCreateDraft((prev) => ({ ...prev, hk_lane_enabled: e.target.checked }))}
                                />
                                <span className="text-[var(--text-secondary)]">Allow to be HK lane</span>
                            </label>
                            <label className="text-sm flex flex-col gap-1 md:col-span-2">
                                <span className="text-[var(--text-secondary)]">HK Lane Order (1-999)</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={999}
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={createDraft.hk_lane_order}
                                    onChange={(e) => setCreateDraft((prev) => ({ ...prev, hk_lane_order: Number(e.target.value) }))}
                                    disabled={!createDraft.hk_lane_enabled}
                                    required={createDraft.hk_lane_enabled}
                                    aria-invalid={
                                        showCreateValidation &&
                                        createDraft.hk_lane_enabled &&
                                        (!Number.isFinite(createDraft.hk_lane_order) || createDraft.hk_lane_order < 1 || createDraft.hk_lane_order > 999)
                                    }
                                />
                                {showCreateValidation &&
                                    createDraft.hk_lane_enabled &&
                                    (!Number.isFinite(createDraft.hk_lane_order) || createDraft.hk_lane_order < 1 || createDraft.hk_lane_order > 999) && (
                                        <span className="text-xs text-rose-600">Lane order must be between 1 and 999.</span>
                                    )}
                            </label>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={closeCreate} disabled={savingCreate}>
                                Cancel
                            </Button>
                            <Button onClick={() => void saveCreate()} disabled={savingCreate}>
                                {savingCreate ? "Saving..." : "Create Lane"}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {invitingStaff && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-xl p-5 space-y-4">
                        <div>
                            <h3 className="text-lg font-bold text-[var(--text-primary)]">Invite Staff Account</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                Creates Auth user + Profile + Staff. Use this for real staff login and LINE bind.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="text-sm flex flex-col gap-1 md:col-span-2">
                                <span className="text-[var(--text-secondary)]">Email</span>
                                <input
                                    type="email"
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={inviteDraft.email}
                                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, email: e.target.value }))}
                                    placeholder="staff@hotel.com"
                                    required
                                    aria-invalid={showInviteValidation && !inviteDraft.email.trim()}
                                />
                                {showInviteValidation && !inviteDraft.email.trim() && (
                                    <span className="text-xs text-rose-600">Email is required.</span>
                                )}
                            </label>
                            <label className="text-sm flex flex-col gap-1">
                                <span className="text-[var(--text-secondary)]">Display Name</span>
                                <input
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={inviteDraft.display_name}
                                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, display_name: e.target.value }))}
                                    required
                                    aria-invalid={showInviteValidation && !inviteDraft.display_name.trim()}
                                />
                                {showInviteValidation && !inviteDraft.display_name.trim() && (
                                    <span className="text-xs text-rose-600">Display name is required.</span>
                                )}
                            </label>
                            <label className="text-sm flex flex-col gap-1">
                                <span className="text-[var(--text-secondary)]">Nickname</span>
                                <input
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={inviteDraft.nickname}
                                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, nickname: e.target.value }))}
                                />
                            </label>
                            <label className="text-sm flex flex-col gap-1">
                                <span className="text-[var(--text-secondary)]">Role</span>
                                <select
                                    className="h-9 rounded-md border px-3 text-sm bg-[var(--bg-surface)]"
                                    value={inviteDraft.role}
                                    onChange={(e) => {
                                        const role = e.target.value as InviteStaffDraft["role"]
                                        const suggestedDept = role === "maid" ? "HK" : "FO"
                                        setInviteDraft((prev) => ({ ...prev, role, department_code: suggestedDept }))
                                    }}
                                >
                                    {ROLE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="text-sm flex flex-col gap-1">
                                <span className="text-[var(--text-secondary)]">Department</span>
                                <select
                                    className="h-9 rounded-md border px-3 text-sm bg-[var(--bg-surface)]"
                                    value={inviteDraft.department_code}
                                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, department_code: e.target.value }))}
                                >
                                    {departments.map((department) => (
                                        <option key={department.id} value={department.code}>
                                            {department.code} - {department.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="text-sm flex items-center gap-2 md:col-span-2">
                                <input
                                    type="checkbox"
                                    checked={inviteDraft.is_active}
                                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, is_active: e.target.checked }))}
                                />
                                <span className="text-[var(--text-secondary)]">Active staff</span>
                            </label>
                            <label className="text-sm flex items-center gap-2 md:col-span-2">
                                <input
                                    type="checkbox"
                                    checked={inviteDraft.hk_lane_enabled}
                                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, hk_lane_enabled: e.target.checked }))}
                                />
                                <span className="text-[var(--text-secondary)]">Allow to be HK lane</span>
                            </label>
                            <label className="text-sm flex flex-col gap-1 md:col-span-2">
                                <span className="text-[var(--text-secondary)]">HK Lane Order (1-999)</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={999}
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={inviteDraft.hk_lane_order}
                                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, hk_lane_order: Number(e.target.value) }))}
                                    disabled={!inviteDraft.hk_lane_enabled}
                                    required={inviteDraft.hk_lane_enabled}
                                    aria-invalid={
                                        showInviteValidation &&
                                        inviteDraft.hk_lane_enabled &&
                                        (!Number.isFinite(inviteDraft.hk_lane_order) || inviteDraft.hk_lane_order < 1 || inviteDraft.hk_lane_order > 999)
                                    }
                                />
                                {showInviteValidation &&
                                    inviteDraft.hk_lane_enabled &&
                                    (!Number.isFinite(inviteDraft.hk_lane_order) || inviteDraft.hk_lane_order < 1 || inviteDraft.hk_lane_order > 999) && (
                                        <span className="text-xs text-rose-600">Lane order must be between 1 and 999.</span>
                                    )}
                            </label>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={closeInvite} disabled={savingInvite}>
                                Cancel
                            </Button>
                            <Button onClick={() => void saveInvite()} disabled={savingInvite}>
                                {savingInvite ? "Saving..." : "Create Staff Account"}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            {editingStaff && editDraft && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm">
                    <Card className="w-full max-w-lg p-5 space-y-4">
                        <div>
                            <h3 className="text-lg font-bold text-[var(--text-primary)]">Edit Staff</h3>
                            <p className="text-xs text-[var(--text-muted)] mt-1">
                                Name updates will sync HK Daily Plans, HK Tasks, and Extra Tasks automatically.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label className="text-sm flex flex-col gap-1">
                                <span className="text-[var(--text-secondary)]">Display Name</span>
                                <input
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={editDraft.display_name}
                                    onChange={(e) => setEditDraft((prev) => prev ? { ...prev, display_name: e.target.value } : prev)}
                                    required
                                    aria-invalid={showEditValidation && !editDraft.display_name.trim()}
                                />
                                {showEditValidation && !editDraft.display_name.trim() && (
                                    <span className="text-xs text-rose-600">Display name is required.</span>
                                )}
                            </label>
                            <label className="text-sm flex flex-col gap-1">
                                <span className="text-[var(--text-secondary)]">Nickname</span>
                                <input
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={editDraft.nickname}
                                    onChange={(e) => setEditDraft((prev) => prev ? { ...prev, nickname: e.target.value } : prev)}
                                />
                            </label>
                            <label className="text-sm flex flex-col gap-1 md:col-span-2">
                                <span className="text-[var(--text-secondary)]">Department</span>
                                <select
                                    className="h-9 rounded-md border px-3 text-sm bg-[var(--bg-surface)]"
                                    value={editDraft.department_id}
                                    onChange={(e) => setEditDraft((prev) => prev ? { ...prev, department_id: e.target.value } : prev)}
                                >
                                    <option value="">Unassigned</option>
                                    {departments.map((department) => (
                                        <option key={department.id} value={department.id}>
                                            {department.code} - {department.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="text-sm flex items-center gap-2 md:col-span-2">
                                <input
                                    type="checkbox"
                                    checked={editDraft.is_active}
                                    onChange={(e) => setEditDraft((prev) => prev ? { ...prev, is_active: e.target.checked } : prev)}
                                />
                                <span className="text-[var(--text-secondary)]">Active staff</span>
                            </label>
                            <label className="text-sm flex items-center gap-2 md:col-span-2">
                                <input
                                    type="checkbox"
                                    checked={editDraft.hk_lane_enabled}
                                    onChange={(e) => setEditDraft((prev) => prev ? { ...prev, hk_lane_enabled: e.target.checked } : prev)}
                                />
                                <span className="text-[var(--text-secondary)]">Allow to be HK lane</span>
                            </label>
                            <label className="text-sm flex flex-col gap-1 md:col-span-2">
                                <span className="text-[var(--text-secondary)]">HK Lane Order (1-999)</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={999}
                                    className="h-9 rounded-md border px-3 text-sm"
                                    value={editDraft.hk_lane_order}
                                    onChange={(e) =>
                                        setEditDraft((prev) =>
                                            prev ? { ...prev, hk_lane_order: Number(e.target.value) } : prev
                                        )
                                    }
                                    disabled={!editDraft.hk_lane_enabled}
                                    required={editDraft.hk_lane_enabled}
                                    aria-invalid={
                                        showEditValidation &&
                                        editDraft.hk_lane_enabled &&
                                        (!Number.isFinite(editDraft.hk_lane_order) || editDraft.hk_lane_order < 1 || editDraft.hk_lane_order > 999)
                                    }
                                />
                                {showEditValidation &&
                                    editDraft.hk_lane_enabled &&
                                    (!Number.isFinite(editDraft.hk_lane_order) || editDraft.hk_lane_order < 1 || editDraft.hk_lane_order > 999) && (
                                        <span className="text-xs text-rose-600">Lane order must be between 1 and 999.</span>
                                    )}
                            </label>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={closeEdit} disabled={savingEdit}>
                                Cancel
                            </Button>
                            <Button onClick={() => void saveEdit()} disabled={savingEdit}>
                                {savingEdit ? "Saving..." : "Save"}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    )
}
