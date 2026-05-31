import assert from "node:assert/strict";
import { getMonthlySummary } from "./monthly.ts";

const fakeSupabase = {
  rpc: async (name: string) => {
    assert.equal(name, "fn_linen_monthly_summary");
    return {
      data: [
        {
          linen_item_id: 1,
          item_number: 1,
          name_th: "ปลอกหมอน",
          name_en: "Pillowcase",
          rate: 10,
          qty_sent: 2,
          qty_returned: 2,
          qty_pending: 0,
          qty_extra: 0,
          qty_dayuse: 3,
          total_baht: 20,
        },
      ],
      error: null,
    };
  },
  from: (table: string) => {
    assert.equal(table, "laundry_monthly_close");
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      async maybeSingle() {
        return { data: null, error: null };
      },
    };
  },
};

const summary = await getMonthlySummary(fakeSupabase as any, 2026, 5);

assert.equal(summary.items[0].total_baht, 50, "monthly summary row total_baht must bill N + O");
assert.equal(summary.total_pieces, 5, "monthly summary pieces must count N + O");
assert.equal(summary.total_baht, 50, "monthly summary grand total must bill N + O");
