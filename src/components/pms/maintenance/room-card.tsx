import { MaintenanceStatusBadge, MaintenanceStatus } from "./status-badge";

interface RoomCardProps {
    room: {
        room_id: string;
        room_number: string;
        room_type_code: string;
        tasks: any[];
    };
    onClick?: (room_id: string) => void;
}

export function MaintenanceRoomCard({ room, onClick }: RoomCardProps) {
    let worstStatus: MaintenanceStatus = 'OK';
    const hasOverdue = room.tasks.some(t => t.status === 'OVERDUE');
    const hasWarning = room.tasks.some(t => t.status === 'WARNING');
    if (hasOverdue) worstStatus = 'OVERDUE';
    else if (hasWarning) worstStatus = 'WARNING';

    // Calculate worst percentage for progress bar
    let worstPercent = 0;
    room.tasks.forEach((t: any) => {
        const pct = t.threshold_count > 0 ? (t.stays_since_last / t.threshold_count) * 100 : 0;
        if (pct > worstPercent) worstPercent = pct;
    });
    const clampedPercent = Math.min(worstPercent, 100);

    const overdueCount = room.tasks.filter((t: any) => t.status === "OVERDUE").length;
    const warningCount = room.tasks.filter((t: any) => t.status === "WARNING").length;
    const progressColor = hasOverdue ? "bg-red-500" : hasWarning ? "bg-amber-400" : "bg-emerald-500";

    return (
        <div
            className={`bg-white rounded-lg border shadow-sm hover:shadow-md transition-all cursor-pointer ${
                hasOverdue ? "border-l-4 border-l-red-500" : hasWarning ? "border-l-4 border-l-amber-400" : "border-l-4 border-l-emerald-400"
            }`}
            onClick={() => onClick?.(room.room_id)}
        >
            <div className="p-3">
                <div className="flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-1.5">
                            <span className="text-lg font-bold text-slate-900">{room.room_number}</span>
                            <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                {room.room_type_code}
                            </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                            <span>{room.tasks.length} tasks</span>
                            {overdueCount > 0 && <span className="text-red-600 font-semibold">{overdueCount} overdue</span>}
                            {warningCount > 0 && <span className="text-amber-600 font-semibold">{warningCount} warning</span>}
                        </div>
                    </div>
                    <MaintenanceStatusBadge status={worstStatus} />
                </div>
                {/* Progress bar */}
                <div className="mt-2.5">
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${progressColor} ${hasOverdue ? "animate-pulse" : ""}`}
                            style={{ width: `${clampedPercent}%` }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
