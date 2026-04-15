"use client";

import { useEffect, useState, useCallback } from "react";

type PageOption = { path: string; label: string; section: string };
type UserProfile = {
  user_id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  allowed_pages: string[] | null;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  supervisor: "Supervisor",
  mobile: "Mobile",
  frontdesk: "Front Desk",
  maid: "Maid",
  staff: "Staff",
};

export default function PermissionsPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [allPages, setAllPages] = useState<PageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [editPages, setEditPages] = useState<string[]>([]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/permissions");
    const data = await res.json();
    if (data.success) {
      setUsers(data.users);
      setAllPages(data.all_pages);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(user: UserProfile) {
    setSelectedUser(user);
    setEditPages(user.allowed_pages ?? ["*"]);
    setSuccessMsg(null);
  }

  function togglePage(path: string) {
    setEditPages((prev) => {
      if (path === "*") return ["*"];
      const without = prev.filter((p) => p !== "*");
      if (without.includes(path)) return without.filter((p) => p !== path);
      return [...without, path];
    });
  }

  async function save() {
    if (!selectedUser) return;
    setSaving(selectedUser.user_id);
    try {
      const res = await fetch("/api/permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: selectedUser.user_id, allowed_pages: editPages }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMsg("บันทึกแล้ว");
        setUsers((prev) => prev.map((u) => u.user_id === selectedUser.user_id ? { ...u, allowed_pages: editPages } : u));
        setTimeout(() => setSuccessMsg(null), 2000);
      }
    } finally {
      setSaving(null);
    }
  }

  // Group pages by section
  const sections = allPages.reduce<Record<string, PageOption[]>>((acc, p) => {
    if (!acc[p.section]) acc[p.section] = [];
    acc[p.section].push(p);
    return acc;
  }, {});

  const isAllAccess = editPages.includes("*");

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">User Permissions</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">กำหนดหน้าที่แต่ละ user สามารถเข้าถึงได้</p>
      </div>

      {loading ? (
        <div className="text-sm text-[var(--text-muted)]">กำลังโหลด...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* User list */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">Users</h2>
            {users.length === 0 && (
              <p className="text-sm text-[var(--text-muted)]">ยังไม่มี user profiles — สร้าง account ใน Supabase Auth ก่อน</p>
            )}
            {users.map((user) => {
              const pages = user.allowed_pages ?? ["*"];
              const hasAllAccess = pages.includes("*");
              const isSelected = selectedUser?.user_id === user.user_id;
              return (
                <button
                  key={user.user_id}
                  onClick={() => openEdit(user)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                    isSelected
                      ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-400 dark:bg-indigo-500/20 dark:border-indigo-500/50 dark:ring-indigo-500/30"
                      : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-input)] hover:bg-[var(--bg-body)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {user.full_name ?? user.email}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {user.email} · {ROLE_LABELS[user.role ?? ""] ?? user.role ?? "No role"}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      hasAllAccess
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                    }`}>
                      {hasAllAccess ? "All Access" : `${pages.length} pages`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Edit panel */}
          {selectedUser && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {selectedUser.full_name ?? selectedUser.email}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">แก้ไข allowed pages</p>
                </div>
                {successMsg && (
                  <span className="text-xs text-emerald-600 font-medium">{successMsg}</span>
                )}
              </div>

              {/* All access toggle */}
              <label className="flex items-center gap-2.5 p-3 bg-[var(--bg-body)] rounded-lg cursor-pointer mb-4 border border-[var(--border-default)] hover:border-[var(--border-input)] transition">
                <input
                  type="checkbox"
                  checked={isAllAccess}
                  onChange={() => setEditPages(isAllAccess ? [] : ["*"])}
                  className="rounded border-[var(--border-input)] text-indigo-500 focus:ring-indigo-400"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Full Access (*)</p>
                  <p className="text-xs text-[var(--text-muted)]">เข้าถึงได้ทุกหน้า (Admin)</p>
                </div>
              </label>

              {/* Individual pages */}
              {!isAllAccess && (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {Object.entries(sections).map(([section, pages]) => (
                    <div key={section}>
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">{section}</p>
                      <div className="space-y-1">
                        {pages.map((page) => (
                          <label key={page.path} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-body)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editPages.includes(page.path)}
                              onChange={() => togglePage(page.path)}
                              className="rounded border-[var(--border-input)] text-indigo-500 focus:ring-indigo-400"
                            />
                            <span className="text-sm text-[var(--text-table-cell)]">{page.label}</span>
                            <span className="text-xs text-[var(--text-muted)] font-mono ml-auto">{page.path}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={save}
                disabled={saving === selectedUser.user_id}
                className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {saving === selectedUser.user_id ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
