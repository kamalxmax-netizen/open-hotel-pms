"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import {
  resolveRoleAwarePostLoginPath,
  sanitizePostLoginPath,
} from "@/lib/auth-routing";
import { markShiftLogoutFreshLogin } from "@/components/shift-logout-reminder";
import { logUiEventNow } from "@/lib/ui-event-log-client";

/* ── Languages ───────────────────────────────────────────────────────── */

type Language = "en" | "hi" | "bn" | "ne";

const translations = {
  en: {
    login: "Login",
    email: "Email",
    password: "Password",
    loginWithLine: "Login with LINE QR",
    or: "or",
    signIn: "Sign In",
    signingIn: "Signing in...",
    loading: "Loading...",
    invalidLogin: "Email or password is incorrect.",
    generalError: "Something went wrong. Please try again.",
    resetPassword: "Contact Admin if you need to reset your password.",
    lineConfig: "LINE Login Channel is not configured.",
    lineState: "LINE Login expired or is incomplete. Please try again.",
    lineNotBound: "This LINE account is not linked to a Staff account in PMS.",
    lineNoEmail:
      "This Staff account has no email for creating a session. Please contact Admin.",
    lineCallback: "LINE Login failed. Please try again.",
  },

  hi: {
    login: "लॉगिन",
    email: "ईमेल",
    password: "पासवर्ड",
    loginWithLine: "LINE QR से लॉगिन करें",
    or: "या",
    signIn: "साइन इन करें",
    signingIn: "साइन इन हो रहा है...",
    loading: "लोड हो रहा है...",
    invalidLogin: "ईमेल या पासवर्ड गलत है।",
    generalError: "कुछ गलत हो गया। कृपया फिर से प्रयास करें।",
    resetPassword: "पासवर्ड रीसेट करने के लिए Admin से संपर्क करें।",
    lineConfig: "LINE Login Channel कॉन्फ़िगर नहीं किया गया है।",
    lineState: "LINE Login की अवधि समाप्त हो गई है या अधूरा है। कृपया फिर से प्रयास करें।",
    lineNotBound: "यह LINE account PMS के Staff account से जुड़ा नहीं है।",
    lineNoEmail:
      "इस Staff account में session बनाने के लिए email नहीं है। कृपया Admin से संपर्क करें।",
    lineCallback: "LINE Login असफल हुआ। कृपया फिर से प्रयास करें।",
  },

  bn: {
    login: "লগইন",
    email: "ইমেইল",
    password: "পাসওয়ার্ড",
    loginWithLine: "LINE QR দিয়ে লগইন করুন",
    or: "অথবা",
    signIn: "সাইন ইন",
    signingIn: "সাইন ইন হচ্ছে...",
    loading: "লোড হচ্ছে...",
    invalidLogin: "ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।",
    generalError: "কিছু সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।",
    resetPassword: "পাসওয়ার্ড রিসেট করতে Admin-এর সাথে যোগাযোগ করুন।",
    lineConfig: "LINE Login Channel কনফিগার করা হয়নি।",
    lineState: "LINE Login-এর সময়সীমা শেষ হয়েছে বা অসম্পূর্ণ। আবার চেষ্টা করুন।",
    lineNotBound: "এই LINE account PMS-এর Staff account-এর সাথে যুক্ত নয়।",
    lineNoEmail:
      "এই Staff account-এ session তৈরির জন্য email নেই। Admin-এর সাথে যোগাযোগ করুন।",
    lineCallback: "LINE Login সফল হয়নি। আবার চেষ্টা করুন।",
  },

  ne: {
    login: "लगइन",
    email: "इमेल",
    password: "पासवर्ड",
    loginWithLine: "LINE QR बाट लगइन गर्नुहोस्",
    or: "वा",
    signIn: "साइन इन",
    signingIn: "साइन इन हुँदैछ...",
    loading: "लोड हुँदैछ...",
    invalidLogin: "इमेल वा पासवर्ड गलत छ।",
    generalError: "केही समस्या भयो। कृपया फेरि प्रयास गर्नुहोस्।",
    resetPassword: "पासवर्ड रिसेट गर्न Admin लाई सम्पर्क गर्नुहोस्।",
    lineConfig: "LINE Login Channel कन्फिगर गरिएको छैन।",
    lineState: "LINE Login को समय सकिएको वा अपूर्ण छ। कृपया फेरि प्रयास गर्नुहोस्।",
    lineNotBound: "यो LINE account PMS को Staff account सँग जोडिएको छैन।",
    lineNoEmail:
      "यस Staff account मा session बनाउन email छैन। कृपया Admin लाई सम्पर्क गर्नुहोस्।",
    lineCallback: "LINE Login सफल भएन। कृपया फेरि प्रयास गर्नुहोस्।",
  },
} as const;

/* ── OpenHotel Geometric Logo ───────────────────────────────────────── */

function OpenHotelLogo({ size = 72 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M40 4 L76 40 L40 76 L4 40 Z"
        stroke="#C9903A"
        strokeWidth="1.5"
        fill="none"
      />

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

      <circle cx="40" cy="40" r="3" fill="#C9903A" />

      <path d="M40 4 L40 12" stroke="#C9903A" strokeWidth="1.5" />
      <path d="M40 68 L40 76" stroke="#C9903A" strokeWidth="1.5" />
      <path d="M4