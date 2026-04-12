import { useState, useEffect } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function useAdminRole() {
    const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const checkRole = async () => {
            try {
                const supabase = createBrowserSupabaseClient();
                const { data: { user } } = await supabase.auth.getUser();
                
                if (!user) {
                    if (mounted) {
                        setIsAdmin(false);
                        setRole(null);
                        setLoading(false);
                    }
                    return;
                }

                const { data } = await supabase
                    .from("profiles")
                    .select("role")
                    .eq("user_id", user.id)
                    .single();

                if (mounted && data) {
                    const role = String(data.role ?? "").trim().toLowerCase();
                    setIsAdmin(role === "admin" || role === "supervisor");
                    setRole(role || null);
                } else if (mounted) {
                    setIsAdmin(false);
                    setRole(null);
                }
            } catch (err) {
                console.error("Failed to fetch user role", err);
                if (mounted) {
                    setIsAdmin(false);
                    setRole(null);
                }
            } finally {
                if (mounted) setLoading(false);
            }
        };

        checkRole();

        return () => {
            mounted = false;
        };
    }, []);

    return { isAdmin, role, loading };
}
