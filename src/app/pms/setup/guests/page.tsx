import Link from "next/link";

const CARDS = [
  {
    href: "/pms/guests",
    title: "Guest Profiles",
    description: "Browse, search, and review guest profile records and verification status.",
    accent: "bg-violet-50 border-violet-200 text-violet-800",
  },
  {
    href: "/pms/rates/plans",
    title: "Tier & Special Access",
    description: "Guest tier and special-profile rate access is managed from Rate Plans.",
    accent: "bg-amber-50 border-amber-200 text-amber-800",
  },
  {
    href: "/pms/guests/duplicates",
    title: "Merge Profiles",
    description: "Resolve duplicates and keep guest history clean.",
    accent: "bg-sky-50 border-sky-200 text-sky-800",
  },
];

export default function GuestSetupPage() {
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">Setup</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-0.5">Guest Setup</h1>
        <p className="text-sm text-slate-500 mt-1">Guest profile tools, merge workflow, and tier-related setup entry points.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CARDS.map((card) => (
          <Link key={card.href} href={card.href} className={`rounded-2xl border p-5 transition hover:shadow-md ${card.accent}`}>
            <div className="space-y-2">
              <h2 className="text-lg font-bold">{card.title}</h2>
              <p className="text-sm opacity-80">{card.description}</p>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Open Module</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
