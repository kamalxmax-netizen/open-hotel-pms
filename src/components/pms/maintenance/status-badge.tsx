import { Badge } from "@/components/ui/badge";

export type MaintenanceStatus = 'OK' | 'WARNING' | 'OVERDUE';

interface StatusBadgeProps {
    status: MaintenanceStatus;
    className?: string;
}

export function MaintenanceStatusBadge({ status, className = "" }: StatusBadgeProps) {
    let colorClass = "";
    let label = "OK";

    switch (status) {
        case 'OK':
            colorClass = "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200";
            label = "OK";
            break;
        case 'WARNING':
            colorClass = "bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200";
            label = "Warning";
            break;
        case 'OVERDUE':
            colorClass = "bg-red-100 text-red-700 hover:bg-red-200 border-red-200";
            label = "Overdue";
            break;
    }

    return (
        <Badge variant="outline" className={`font-semibold ${colorClass} ${className}`}>
            {label}
        </Badge>
    );
}
