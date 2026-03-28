"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, Banknote, ArrowRightLeft } from "lucide-react";

export default function DepositStep() {
  const params = useParams();
  const router = useRouter();
  const resId = params.resId as string;

  const [method, setMethod] = useState<string>("cash");
  const [depositAmount, setDepositAmount] = useState<string>("");

  useEffect(() => {
    const saved = sessionStorage.getItem(`mobile-checkin-${resId}`);
    if (!saved) {
      router.replace("/pms/mobile-checkin");
      return;
    }
    const parsed = JSON.parse(saved);
    if (parsed.deposit_method) setMethod(parsed.deposit_method);
    if (parsed.deposit_amount != null) setDepositAmount(String(parsed.deposit_amount));
  }, [resId, router]);

  const onNext = () => {
    const depVal = parseFloat(depositAmount);
    if (depositAmount && (isNaN(depVal) || depVal < 0 || depVal > 999999)) {
      alert("Please enter a valid deposit amount.");
      return;
    }

    const savedLine = sessionStorage.getItem(`mobile-checkin-${resId}`);
    const session = savedLine ? JSON.parse(savedLine) : {};
    session.deposit_method = method;
    session.deposit_amount = depositAmount ? depVal : 0;
    sessionStorage.setItem(`mobile-checkin-${resId}`, JSON.stringify(session));
    router.push(`/pms/mobile-checkin/confirm/${resId}`);
  };

  const paymentOptions = [
    { id: "cash", label: "Cash", icon: Banknote },
    { id: "credit_card", label: "Credit Card", icon: CreditCard },
    { id: "transfer", label: "Transfer", icon: ArrowRightLeft },
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg-muted)] pb-24">
      <header className="px-6 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)] sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-3 -ml-3 rounded-full hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)] transition"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-brand-600 tracking-wider">STEP 3/4</span>
            <h1 className="text-xl font-bold tracking-tight">Deposit (Optional)</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider">Select Method</h3>
          <div className="grid grid-cols-2 gap-4">
            {paymentOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setMethod(opt.id)}
                className={`relative overflow-hidden rounded-2xl p-5 border-2 transition-all active:scale-[0.98] ${
                  method === opt.id
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400 shadow-md"
                    : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                }`}
              >
                <div className="flex flex-col items-center justify-center gap-3">
                  <opt.icon className={`w-8 h-8 ${method === opt.id ? "text-brand-500 opacity-100" : "opacity-50"}`} />
                  <span className="font-bold text-sm tracking-wide">{opt.label}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 pt-4 border-t border-[var(--border-default)]">
          <h3 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-wider">Deposit Amount</h3>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-black text-lg">
              ฿
            </span>
            <input
              type="number"
              min="0"
              max="999999"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="0.00"
              className="w-full h-14 pl-10 pr-4 rounded-xl border border-[var(--border-input)] bg-[var(--bg-surface)] text-xl font-bold text-[var(--text-primary)] focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--bg-muted)] to-transparent pointer-events-none">
        <div className="max-w-lg mx-auto pointer-events-auto">
          <button
            onClick={onNext}
            className="w-full h-14 bg-brand-600 text-white rounded-2xl font-black tracking-widest uppercase shadow-xl shadow-brand-500/30 active:scale-[0.98] transition-all flex items-center justify-center"
          >
            Next: Confirm <ArrowLeft className="w-6 h-6 ml-2 rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}
