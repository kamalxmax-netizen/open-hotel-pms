import Link from "next/link";

const MODULES = [
  {
    href: "/pms/setup/operations/alerts",
    title: "Alert Templates",
    description: "Persistent warning templates with configurable display surfaces and severity.",
    accent: "bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300",
  },
  {
    href: "/pms/setup/operations/traces",
    title: "Trace Templates",
    description: "Quick text templates for FD and HK operational trace workflows.",
    accent: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300",
  },
  {
    href: "/pms/setup/operations/loan-items",
    title: "Loan Items",
    description: "Control stock, HK collection behavior, and extra charge reminders for borrowed items.",
    accent: "bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-500/10 dark:border-sky-500/30 dark:text-sky-300",
  },
  {
    href: "/pms/setup/operations/fees",
    title: "Extra Charge Templates",
    description: "Manage extra fee, damage, policy, and penalty templates from Operations Setup.",
    accent: "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300",
  },
];

export default function OperationsSetupPage() {
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Setup</p>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mt-0.5">Operations Setup</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Operational master data for alerts, traces, loan items, and extra charge templates.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {MODULES.map((module) => (
          <Link key={module.href} href={module.href} className={`rounded-2xl border p-5 transition hover:shadow-md ${module.accent}`}>
            <div className="space-y-2">
              <h2 className="text-lg font-bold">{module.title}</h2>
              <p className="text-sm opacity-80">{module.description}</p>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Open Module</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
