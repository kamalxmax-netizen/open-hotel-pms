import assert from "node:assert/strict";
import { resolveLinkedStayBatch } from "./linked-stay.ts";

type ReservationRow = {
  id: string;
  parent_reservation_id: string | null;
  booking_code: string | null;
  source: string | null;
  checkin_date: string;
  checkout_date: string;
  checked_in_at: string | null;
  status: string;
  total_price: number;
};

function createReservationsClient(children: ReservationRow[]) {
  return {
    from(table: string) {
      assert.equal(table, "reservations");
      return {
        select() {
          return {
            in(column: string) {
              if (column === "id") {
                return Promise.resolve({ data: [], error: null });
              }
              if (column === "parent_reservation_id") {
                return {
                  order() {
                    return Promise.resolve({ data: children, error: null });
                  },
                };
              }
              throw new Error(`Unexpected in() column: ${column}`);
            },
          };
        },
      };
    },
  };
}

const parent: ReservationRow = {
  id: "parent-reservation",
  parent_reservation_id: null,
  booking_code: "BK-PARENT",
  source: "ota",
  checkin_date: "2026-05-18",
  checkout_date: "2026-05-20",
  checked_in_at: "2026-05-18T11:49:24.703+00:00",
  status: "active",
  total_price: 1040,
};

const child: ReservationRow = {
  id: "child-extension",
  parent_reservation_id: parent.id,
  booking_code: "BK-CHILD",
  source: "ota",
  checkin_date: "2026-05-20",
  checkout_date: "2026-05-23",
  checked_in_at: parent.checked_in_at,
  status: "active",
  total_price: 1560,
};

const RealDate = Date;

class FakeDate extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) {
      super("2026-05-19T18:30:00.000Z");
      return;
    }
    super(...(args as [any]));
  }

  static now() {
    return new RealDate("2026-05-19T18:30:00.000Z").getTime();
  }
}

(globalThis as any).Date = FakeDate;
try {
  const linkedStayMap = await resolveLinkedStayBatch(
    createReservationsClient([child]) as any,
    [parent],
    "12:00",
    { activeDate: "2026-05-19", activeTimeHHmm: "23:30" }
  );

  assert.equal(
    linkedStayMap.get(parent.id)?.active_segment_id,
    parent.id,
    "Linked stay active segment should follow hotel business date before Night Audit advances"
  );
} finally {
  (globalThis as any).Date = RealDate;
}
