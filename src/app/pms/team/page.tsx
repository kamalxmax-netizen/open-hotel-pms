import { TeamTabs } from "./_components/TeamTabs"

export const metadata = {
    title: "Team & Shifts | Hotel PMS",
}

export default function TeamPage() {
    return (
        <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Team & Shifts</h1>
                <p className="text-muted-foreground">
                    Manage staff directory, LINE bot binding, and view daily rosters.
                </p>
            </div>

            <TeamTabs />
        </div>
    )
}
