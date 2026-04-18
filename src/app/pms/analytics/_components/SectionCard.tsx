import Link from "next/link";

type SectionCardProps = {
    href: string;
    title: string;
    subtitle: string;
    phase: string;
    enabled: boolean;
};

export function SectionCard({ href, title, subtitle, phase, enabled }: SectionCardProps) {
    const content = (
        <div className="a-card p-5 flex flex-col gap-3 h-full">
            <div className="flex items-start justify-between">
                <div className="flex flex-col gap-1">
                    <span className="a-muted text-[11px] uppercase tracking-[0.2em]">{phase}</span>
                    <span className="text-lg font-semibold">{title}</span>
                </div>
                <span className={`a-badge ${enabled ? "a-badge-green" : "a-badge-na"}`}>
                    {enabled ? "Ready" : "Soon"}
                </span>
            </div>
            <p className="a-secondary text-sm">{subtitle}</p>
            <div className="a-muted text-xs mt-auto">{enabled ? "Open →" : "Placeholder"}</div>
        </div>
    );

    return enabled ? (
        <Link href={href} className="block">
            {content}
        </Link>
    ) : (
        <div className="opacity-60 cursor-not-allowed">{content}</div>
    );
}
