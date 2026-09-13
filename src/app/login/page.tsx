"use client";

import { Suspense, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  resolveRoleAwarePostLoginPath,
  sanitizePostLoginPath,
} from "@/lib/auth-routing";
import { markShiftLogoutFreshLogin } from "@/components/shift-logout-reminder";
import { logUiEventNow } from "@/lib/ui-event-log-client";

/* ============================================================
   OPENHOTEL LOGO
   No SVG - safe JSX
   ============================================================ */

function OpenHotelLogo({ size = 76 }: { size?: number }) {
  const outer: CSSProperties = {
    width: size,
    height: size,
    border: "2px solid #C9903A",
    transform: "rotate(45deg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  };

  const inner: CSSProperties = {
    width: size * 0.52,
    height: size * 0.52,
    border: "2px solid #C9903A",
    borderRadius: "50%",
    position: "relative",
    boxSizing: "border-box",
  };

  const center: CSSProperties = {
    position: "absolute",
    width: 8,
    height: 8,
    backgroundColor: "#C9903A",
    borderRadius: "50%",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
  };

  return (
    <div style={outer}>
      <div style={inner}>
        <div style={center} />
      </div>
    </div>
  );
}

/* ============================================================
   BACKGROUND
   ============================================================ */

const DIAMOND_PATTERN =
  "url(\"data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 2L58 30L30 58L2 30Z' fill='none' stroke='%23ffffff' stroke-width='0.6' stroke-opacity='0.07'/%3E%3C/svg%3E\")";

/* ============================================================
   LINE ERROR
   ============================================================ */

function resolveLineLoginError(
  value: string | null
): string | null {
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

/* ============================================================
   LOGIN FORM
   ============================================================ */

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const next = sanitizePostLoginPath(
    searchParams.get("next")
  );

  const lineError = resolveLineLoginError(
    searchParams.get("line_error")
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /* ==========================================================
     LOGIN
     ========================================================== */

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError(null);
    setLoading(true);

    try {
      const supabase = createBrowserSupabaseClient();

      const result =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      const signInData = result.data;
      const signInError = result.error;

      if (signInError) {
        setError("Invalid email or password.");
        return;
      }

      const userId = signInData.user?.id ?? null;

      markShiftLogoutFreshLogin(userId);

      let destination = next;

      /* ========================================================
         PROFILE / ROLE
         ======================================================== */

      if (userId) {
        const profileResult = await supabase
          .from("profiles")
          .select("role, allowed_pages")
          .eq("user_id", userId)
          .maybeSingle();

        const profileData = profileResult.data;

        destination =
          resolveRoleAwarePostLoginPath(
            destination,
            profileData?.role,
            profileData?.allowed_pages
          );
      }

      /* ========================================================
         LOG LOGIN
         ======================================================== */

      await logUiEventNow({
        pathname: "/login",
        event_type: "auth_activity",
        event_name: "login_succeeded",
        metadata: {
          method: "password",
          destination,
        },
      });

      /* ========================================================
         REDIRECT
         ======================================================== */

      router.push(destination);
      router.refresh();
    } catch {
      setError(
        "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  /* ==========================================================
     INPUT STYLE
     ========================================================== */

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: "8px",
    border: "1px solid #e2e8f0",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
    backgroundColor: "#ffffff",
    color: "#334155",
  };

  /* ==========================================================
     PAGE
     ========================================================== */

  return (
    <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">

      {/* Gold bar */}
      <div
        className="h-1 w-full"
        style={{
          background:
            "linear-gradient(90deg, #C9903A, #E8B96A, #C9903A)",
        }}
      />

      <div className="p-8">

        <h2 className="text-base font-semibold text-slate-700 mb-5 tracking-wide">
          Sign In
        </h2>

        {/* LINE error */}
        {lineError && (
          <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-600 text-xs px-3.5 py-2.5 rounded-lg">
            {lineError}
          </div>
        )}

        {/* LINE LOGIN */}

        <a
          href={`/api/auth/line/start?next=${encodeURIComponent(
            next
          )}`}
          className="mb-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#06C755] px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-white text-xs font-black text-[#06C755]">
            L
          </span>

          Login with LINE QR
        </a>

        {/* OR */}

        <div className="mb-5 flex items-center gap-3">

          <div className="h-px flex-1 bg-slate-200" />

          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            OR
          </span>

          <div className="h-px flex-1 bg-slate-200" />

        </div>

        {/* EMAIL / PASSWORD */}

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* Email */}

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
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="staff@example.com"
              required
              autoComplete="username"
              style={inputStyle}
              onFocus={(event) => {
                event.currentTarget.style.borderColor =
                  "#C9903A";
                event.currentTarget.style.boxShadow =
                  "0 0 0 2px rgba(201,144,58,0.12)";
              }}
              onBlur={(event) => {
                event.currentTarget.style.borderColor =
                  "#e2e8f0";
                event.currentTarget.style.boxShadow =
                  "none";
              }}
            />

          </div>

          {/* Password */}

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
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={inputStyle}
              onFocus={(event) => {
                event.currentTarget.style.borderColor =
                  "#C9903A";
                event.currentTarget.style.boxShadow =
                  "0 0 0 2px rgba(201,144,58,0.12)";
              }}
              onBlur={(event) => {
                event.currentTarget.style.borderColor =
                  "#e2e8f0";
                event.currentTarget.style.boxShadow =
                  "none";
              }}
            />

          </div>

          {/* Login error */}

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-600 text-xs px-3.5 py-2.5 rounded-lg">
              {error}
            </div>
          )}

          {/* Submit */}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-white font-medium py-2.5 rounded-lg text-sm transition-all mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: loading
                ? "#B8832E"
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

/* ============================================================
   LOGIN PAGE
   ============================================================ */

export default function LoginPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        backgroundColor: "#1B4038",
        backgroundImage: DIAMOND_PATTERN,
      }}
    >

      <div className="w-full max-w-sm">

        {/* Logo */}

        <div className="text-center mb-8">

          <div className="flex justify-center mb-4">
            <OpenHotelLogo size={76} />
          </div>

          <h1
            className="text-xl font-bold tracking-[0.18em] uppercase"
            style={{
              color: "#C9903A",
            }}
          >
            OpenHotel
          </h1>

          <p className="text-white text-sm font-light tracking-[0.25em] uppercase mt-0.5 opacity-90">
            Hotel PMS
          </p>

          <p
            className="text-xs mt-2 tracking-wide opacity-50"
            style={{
              color: "#a8d4c4",
            }}
          >
            Internal Staff Portal
          </p>

        </div>

        {/* Login */}

        <Suspense
          fallback={
            <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
              <p className="text-sm text-slate-400">
                Loading...
              </p>
            </div>
          }
        >
          <LoginForm />
        </Suspense>

        {/* Footer */}

        <p
          className="text-center text-xs mt-6 opacity-40 tracking-wide"
          style={{
            color: "#a8d4c4",
          }}
        >
          Contact Admin if you need to reset your password.
        </p>

      </div>
    </main>
  );
}