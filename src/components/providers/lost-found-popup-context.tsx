"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";
import { LostFoundGuestAlert } from "@/lib/types";
import LfReturnGuestPopup from "../lost-found/lf-return-guest-popup";

interface LostFoundPopupContextType {
    showPopup: (data: LostFoundGuestAlert) => void;
    hidePopup: () => void;
}

const LostFoundPopupContext = createContext<LostFoundPopupContextType | undefined>(undefined);

export function LostFoundPopupProvider({ children }: { children: ReactNode }) {
    const [alertData, setAlertData] = useState<LostFoundGuestAlert | null>(null);

    const showPopup = (data: LostFoundGuestAlert) => {
        // Only show if there are items
        if (data.items && data.items.length > 0) {
            setAlertData(data);
        }
    };

    const hidePopup = () => {
        setAlertData(null);
    };

    return (
        <LostFoundPopupContext.Provider value={{ showPopup, hidePopup }}>
            {children}
            {alertData && (
                <LfReturnGuestPopup data={alertData} onClose={hidePopup} />
            )}
        </LostFoundPopupContext.Provider>
    );
}

export function useLostFoundPopup() {
    const context = useContext(LostFoundPopupContext);
    if (context === undefined) {
        throw new Error("useLostFoundPopup must be used within a LostFoundPopupProvider");
    }
    return context;
}
