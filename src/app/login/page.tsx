"use client";

import {
  useState,
  type FormEvent,
  type CSSProperties,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  resolveRoleAwarePostLoginPath,
  sanitizePostLoginPath,
} from "@/lib/auth-routing";
import { markShiftLogoutFreshLogin } from "@/components/shift-logout-reminder";
import { logUiEventNow } from "@/lib/ui-event-log-client";

/* ─────────────────────────────────────────────────────────────
   OpenHotel Logo — DIV-BASED (no <svg>, cannot break the parser)
   ───────────────────────────────────────────────────────────── */

function OpenHotelLogo({ size = 72 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: "2px solid #C9903A",
        transform: "rotate(45deg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: size * 0.5,
          height: size * 0.5,
          border: "2px solid #C9903A",
          borderRadius: "50%",
          position: "relative",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 8,
            height: 8,
            background: "#C9903A",
            borderRadius: "50%",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Diamond Background Pattern
   ───────────────────────────────────────────────────────────── */

const DIAMOND_PATTERN =
  "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 2L58 30L30 58L2 30Z' stroke='%23ffffff' stroke-width='0.6' stroke-opacity='0.07' fill='none'/%3E%3C/svg%3E\")";

/* ─────────────────────────────────────────────────────────────
   LINE Login Error Messages
   ───────────────────────────────────────────────────────────── */

function resolveLineLoginError(value: string | null): string | null {
  switch (value) {
    case "config":
      return "LINE Login is not configured.";
    case "state":
      return "LINE Login expired or is invalid. Please try again.";
    case "not_bound":
      return "This LINE account is not linked to a staff account.";
    case "no_email":
      return "This staff account does not have an email address. Please contact Admin.";
    case "callback":
      return "LINE Login failed. Please try again.";
    default:
      return null;
  }
}

/* ─────────────────────────────────────────────────────────────
   Login Form
   ───────────────────────────────────────────────────────────── */

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const next = sanitizePostLoginPath(searchParams.get("next"));
  const lineError = resolveLineLoginError(searchParams.get("line_error"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    setError(null);
    setLoading(true);

    let destination = next;
    let loggedIn = false;

    try {
      const supabase = createBrowserSupabaseClient();

      const { data: signInData, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError || !signInData?.user) {
        setError("Invalid email or password.");
        return;
      }

      loggedIn = true;
      const userId = signInData.user.id;

      try {
        markShiftLogoutFreshLogin(userId);
      } catch {
        /* non-fatal */
      }

      try {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("role, allowed_pages")
          .eq("user_id", userId)
          .maybeSingle();

        destination = resolveRoleAwarePostLoginPath(
          destination,
          profileData?.role ?? null,
          profileData?.allowed_pages ?? null
        );
      } catch {
        /* non-fatal — fall back to sanitized `next` */
      }

      // Fire-and-forget: must not block the redirect.
      void logUiEventNow({
        pathname: "/login",
        event_type: "auth_activity",
        event_name: "login_succeeded",
        metadata: { method: "password", destination },
      });
    } catch {
      if (!loggedIn) {
        setError("Something went wrong. Please try again.");
        return;
      }
    } finally {
      setLoading(false);
    }

    if (loggedIn) {
      router.replace(destination);
      router.refresh();
    }
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    fontSize: "14px",
    outline: "none",
    transition: "border-color 0.2s ease",
    boxSizing: "border-box",
    backgroundColor: "#ffffff",
    color: "#334155",
  };

  return (
    <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
      <div
        className="h-1 w-full"
        style={{
          background: "linear-gradient(90deg, #C9903A, #E8B96A, #C9903A)",
        }}
      />

      <div className="p-8">
        <h2 className="text-base font-semibold text-slate-700 mb-5 tracking-wide">
          Sign In
        </h2>

        {lineError && (
          <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-600 text-xs px-3.5 py-2.5 rounded-lg">
            {lineError}
          </div>
        )}

        <a
          href={`/api/auth/line/start?next=${encodeURIComponent(next)}`}
          className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#06C755] px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#05b64d] focus:outline-none focus:ring-2 focus:ring-[#06C755]/30"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-white text-xs font-black text-[#06C755]">
            L
          </span>
          Login with LINE QR
        </a>

        <div className="mb-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            OR
          </span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium text-slate-500 mb-1.5 tracking-widest uppercase"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@example.com"
              required
              autoComplete="username"
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#C9903A";
                e.currentTarget.style.boxShadow =
                  "0 0 0 2px rgba(201,144,58,0.12)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#e2e8f0";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-medium text-slate-500 mb-1.5 tracking-widest uppercase"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#C9903A";
                e.currentTarget.style.boxShadow =
                  "0 0 0 2px rgba(201,144,58,0.12)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#e2e8f0";
                e.currentTarget.style.boxShadow = "none";
              }}
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
              boxShadow: loading
                ? "none"
                : "0 4px 14px rgba(201,144,58,0.35)",
            }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Login Page
   ───────────────────────────────────────────────────────────── */

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

          <p
            className="text-xs mt-2 tracking-wide opacity-50"
            style={{ color: "#a8d4c4" }}
          >
            Internal Staff Portal
          </p>
        </div>

        <Suspense
          fallback={
            <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
              <p className="text-sm text-slate-400">Loading...</p>
            </div>
          }
        >
          <LoginForm />
        </Suspense>

        <p
          className="text-center text-xs mt-6 opacity-40 tracking-wide"
          style={{ color: "#a8d4c4" }}
        >
          Contact Admin if you need to reset your password.
        </p>
      </div>
    </div>
  );
}