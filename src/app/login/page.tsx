"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

/* ── OpenHotel Geometric Logo (SVG) ──────────────────────────────────── */
function OpenHotelLogo({ size = 72 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer diamond border */}
      <path
        d="M40 4 L76 40 L40 76 L4 40 Z"
        stroke="#C9903A"
        strokeWidth="1.5"
        fill="none"
      />
      {/* Geometric flower — 4 petals */}
      <path
        d="M40 16 C40 16 28 28 28 40 C28 52 40 64 40 64 C40 64 52 52 52 40 C52 28 40 16 40 16Z"
        stroke="#C9903A"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M16 40 C16 40 28 28 40 28 C52 28 64 40 64 40 C64 40 52 52 40 52 C28 52 16 40 16 40Z"
        stroke="#C9903A"
        strokeWidth="1.5"
        fill="none"
      />
      {/* Center dot */}
      <circle cx="40" cy="40" r="3" fill="#C9903A" />
      {/* Corner accents */}
      <path d="M40 4 L40 12" stroke="#C9903A" strokeWidth="1.5" />
      <path d="M40 68 L40 76" stroke="#C9903A" strokeWidth="1.5" />
      <path d="M4 40 L12 40" stroke="#C9903A" strokeWidth="1.5" />
      <path d="M68 40 L76 40" stroke="#C9903A" strokeWidth="1.5" />
    </svg>
  );
}

/* ── Diamond Background Pattern ──────────────────────────────────────── */
const DIAMOND_PATTERN = `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 2L58 30L30 58L2 30Z' stroke='%23ffffff' stroke-width='0.6' stroke-opacity='0.07' fill='none'/%3E%3C/svg%3E")`;

/* ── Login Form ───────────────────────────────────────────────────────── */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/pms/board";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError("Email หรือ Password ไม่ถูกต้อง");
        return;
      }
      const destination = next === "/pms" ? "/pms/board" : next;
      router.push(destination.startsWith("/pms") || destination === "/" ? destination : "/pms/board");
      router.refresh();
    } catch {
      setError("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
      {/* Gold top bar */}
      <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #C9903A, #E8B96A, #C9903A)" }} />

      <div className="p-8">
        <h2 className="text-base font-semibold text-slate-700 mb-5 tracking-wide">
          เข้าสู่ระบบ
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5 tracking-widest uppercase">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@example.com"
              required
              autoComplete="username"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none transition"
              style={{ "--tw-ring-color": "#C9903A" } as React.CSSProperties}
              onFocus={(e) => (e.target.style.borderColor = "#C9903A")}
              onBlur={(e) => (e.target.style.borderColor = "")}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5 tracking-widest uppercase">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none transition"
              onFocus={(e) => (e.target.style.borderColor = "#C9903A")}
              onBlur={(e) => (e.target.style.borderColor = "")}
            />
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-600 text-xs px-3.5 py-2.5 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-medium py-2.5 rounded-lg text-sm transition-all mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: loading
                ? "#b8832e"
                : "linear-gradient(135deg, #C9903A, #E0A84A)",
              boxShadow: loading ? "none" : "0 4px 14px rgba(201,144,58,0.35)",
            }}
          >
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function LoginPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        backgroundColor: "#1B4038",
        backgroundImage: DIAMOND_PATTERN,
      }}
    >
      <div className="w-full max-w-sm">
        {/* Logo + Hotel name */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <OpenHotelLogo size={76} />
          </div>
          <h1
            className="text-xl font-bold tracking-[0.18em] uppercase"
            style={{ color: "#C9903A" }}
          >
            OpenHotel
          </h1>
          <p className="text-white text-sm font-light tracking-[0.25em] uppercase mt-0.5 opacity-90">
            Hotel PMS
          </p>
          <p className="text-xs mt-2 tracking-wide opacity-50" style={{ color: "#a8d4c4" }}>
            Internal Staff Portal
          </p>
        </div>

        <Suspense
          fallback={
            <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
              <p className="text-sm text-slate-400">กำลังโหลด...</p>
            </div>
          }
        >
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs mt-6 opacity-40 tracking-wide" style={{ color: "#a8d4c4" }}>
          ติดต่อ Admin หากต้องการรีเซ็ตรหัสผ่าน
        </p>
      </div>
    </div>
  );
}
