import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function PrintPeriodPage({ params, searchParams }: any) {
  const supabase = createServerSupabaseClient();
  const year = parseInt(params.year);
  const month = parseInt(params.month);
  const channelGroup = searchParams.channel_group;

  if (!channelGroup) {
    return (
      <div className="p-8 text-rose-500 font-bold">
        Error: channel_group is required for period print mode.
      </div>
    );
  }

  const { data } = await supabase
    .from("monthly_audit_periods")
    .select("id")
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  if (!data) {
    return <div className="p-8">Audit period not found for {month}/{year}</div>;
  }

  redirect(`/api/tax-invoice/abbreviated/${data.id}/print?mode=period&channel_group=${channelGroup}`);
}
