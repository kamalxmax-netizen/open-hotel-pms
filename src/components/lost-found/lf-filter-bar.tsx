"use client";

import { Search, FilterX } from "lucide-react";

export interface LfFilterState {
    status: string;
    dateFrom: string;
    dateTo: string;
    room: string;
    guest: string;
    reportedBy: string;
}

interface LfFilterBarProps {
    filters: LfFilterState;
    onChange: (filters: LfFilterState) => void;
}

export default function LfFilterBar({ filters, onChange }: LfFilterBarProps) {
    const handleChange = (key: keyof LfFilterState, value: string) => {
        onChange({ ...filters, [key]: value });
    };

    const handleClear = () => {
        onChange({
            status: "all",
            dateFrom: "",
            dateTo: "",
            room: "",
            guest: "",
            reportedBy: "",
        });
    };

    return (
        <div className="card p-4 mb-6 flex flex-wrap gap-4 items-end bg-[var(--bg-body)]">
            <div className="flex-1 min-w-[200px]">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search Guest Name..."
                        className="form-input pl-9"
                        value={filters.guest}
                        onChange={(e) => handleChange("guest", e.target.value)}
                    />
                </div>
            </div>

            <div className="w-32">
                <label className="form-label text-[10px]">Room No.</label>
                <input
                    type="text"
                    placeholder="e.g. 201"
                    className="form-input"
                    value={filters.room}
                    onChange={(e) => handleChange("room", e.target.value)}
                />
            </div>

            <div className="w-40">
                <label className="form-label text-[10px]">Status</label>
                <select
                    className="form-input"
                    value={filters.status}
                    onChange={(e) => handleChange("status", e.target.value)}
                >
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="claimed">Claimed</option>
                </select>
            </div>

            <div className="w-36">
                <label className="form-label text-[10px]">From Date</label>
                <input
                    type="date"
                    className="form-input"
                    value={filters.dateFrom}
                    onChange={(e) => handleChange("dateFrom", e.target.value)}
                />
            </div>

            <div className="w-36">
                <label className="form-label text-[10px]">To Date</label>
                <input
                    type="date"
                    className="form-input"
                    value={filters.dateTo}
                    onChange={(e) => handleChange("dateTo", e.target.value)}
                />
            </div>

            <div className="w-48">
                <label className="form-label text-[10px]">Reported By</label>
                <input
                    type="text"
                    placeholder="Staff name..."
                    className="form-input"
                    value={filters.reportedBy}
                    onChange={(e) => handleChange("reportedBy", e.target.value)}
                />
            </div>

            <button
                onClick={handleClear}
                className="btn-ghost px-3 h-[38px] text-[var(--text-muted)] hover:text-rose-500"
                title="Clear Filters"
            >
                <FilterX className="w-4 h-4" />
            </button>
        </div>
    );
}
