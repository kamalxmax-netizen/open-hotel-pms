"use client";

import type { RateRuleGroupMember, RoundingMode, RuleActionType } from "@/lib/rates/dynamic-types";

type RoomTypeOption = {
  type_id: string;
  type_name: string;
};

type MemberTableProps = {
  members: RateRuleGroupMember[];
  roomTypes: RoomTypeOption[];
  onChange: (members: RateRuleGroupMember[]) => void;
  disabled?: boolean;
};

const ACTION_OPTIONS: Array<{ value: RuleActionType; label: string }> = [
  { value: "percent", label: "Percent" },
  { value: "fixed_thb", label: "Fixed THB" },
  { value: "step", label: "Step" },
  { value: "override", label: "Override" },
];

const ROUNDING_OPTIONS: Array<{ value: RoundingMode; label: string }> = [
  { value: "none", label: "None" },
  { value: "nearest_10", label: "Nearest 10" },
  { value: "nearest_50", label: "Nearest 50" },
  { value: "nearest_100", label: "Nearest 100" },
];

function withRoomTypeName(member: RateRuleGroupMember, roomTypes: RoomTypeOption[]) {
  const match = roomTypes.find((roomType) => roomType.type_id === member.room_type_id);
  return {
    ...member,
    room_type_name: match?.type_name ?? member.room_type_name,
  };
}

export default function MemberTable({ members, roomTypes, onChange, disabled = false }: MemberTableProps) {
  function updateMember(index: number, patch: Partial<RateRuleGroupMember>) {
    const next = members.map((member, memberIndex) =>
      memberIndex === index ? withRoomTypeName({ ...member, ...patch }, roomTypes) : member
    );
    onChange(next);
  }

  function addMember() {
    const fallbackRoomType = roomTypes[0];
    if (!fallbackRoomType) return;
    onChange([
      ...members,
      {
        room_type_id: fallbackRoomType.type_id,
        room_type_name: fallbackRoomType.type_name,
        action_type: "percent",
        action_value: 10,
        rounding: "nearest_10",
      },
    ]);
  }

  function removeMember(index: number) {
    onChange(members.filter((_, memberIndex) => memberIndex !== index));
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border">
        <table className="data-table w-full text-sm">
          <thead className="bg-black/5 dark:bg-white/5">
            <tr>
              <th className="text-left py-2 px-3">Room Type</th>
              <th className="text-left py-2 px-3">Action</th>
              <th className="text-left py-2 px-3">Value</th>
              <th className="text-left py-2 px-3">Rounding</th>
              <th className="w-16"></th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-[var(--text-muted)] italic">
                  No members defined.
                </td>
              </tr>
            ) : (
              members.map((member, index) => (
                <tr key={`${member.room_type_id}-${index}`} className="border-t">
                  <td className="py-2 px-3">
                    <select
                      className="form-select py-1 text-sm"
                      value={member.room_type_id}
                      disabled={disabled}
                      onChange={(event) =>
                        updateMember(index, {
                          room_type_id: event.target.value,
                          room_type_name:
                            roomTypes.find((roomType) => roomType.type_id === event.target.value)?.type_name ?? undefined,
                        })
                      }
                    >
                      {roomTypes.map((roomType) => (
                        <option key={roomType.type_id} value={roomType.type_id}>
                          {roomType.type_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    <select
                      className="form-select py-1 text-sm"
                      value={member.action_type}
                      disabled={disabled}
                      onChange={(event) =>
                        updateMember(index, { action_type: event.target.value as RuleActionType })
                      }
                    >
                      {ACTION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3">
                    <input
                      type="number"
                      step="0.01"
                      className="form-input py-1 text-sm"
                      value={member.action_value}
                      disabled={disabled}
                      onChange={(event) =>
                        updateMember(index, { action_value: Number(event.target.value || 0) })
                      }
                    />
                  </td>
                  <td className="py-2 px-3">
                    <select
                      className="form-select py-1 text-sm"
                      value={member.rounding}
                      disabled={disabled}
                      onChange={(event) =>
                        updateMember(index, { rounding: event.target.value as RoundingMode })
                      }
                    >
                      {ROUNDING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      type="button"
                      className="btn btn-secondary text-xs"
                      disabled={disabled}
                      onClick={() => removeMember(index)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <button type="button" className="btn btn-secondary text-sm" disabled={disabled || roomTypes.length === 0} onClick={addMember}>
        + Add Member
      </button>
    </div>
  );
}
