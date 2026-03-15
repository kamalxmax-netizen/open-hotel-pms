"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LogbookRichBody } from "@/lib/types"
import { LOGBOOK_TEXT_COLORS, cycleRichTextSize } from "./logbook-rich"

interface LogbookRichToolbarProps {
  richBody: LogbookRichBody
  remindAt: string | null
  canUndo: boolean
  canRedo: boolean
  variant?: "compact" | "full"
  onChangeRichBody: (next: LogbookRichBody) => void
  onChangeRemindAt: (value: string | null) => void
  onUndo: () => void
  onRedo: () => void
}

function toLocalDateTimeValue(value: string | null): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromLocalDateTimeValue(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function getTomorrowNineAm(): string {
  const next = new Date()
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  return next.toISOString()
}

export function LogbookRichToolbar({
  richBody,
  remindAt,
  canUndo,
  canRedo,
  variant = "compact",
  onChangeRichBody,
  onChangeRemindAt,
  onUndo,
  onRedo,
}: LogbookRichToolbarProps) {
  const isCompact = variant === "compact"

  return (
    <div
      className={`rounded-xl border border-black/10 bg-white/75 backdrop-blur-sm ${
        isCompact ? "px-1.5 py-1" : "px-3 py-2"
      }`}
      data-no-drag
    >
      <div className={`flex flex-wrap items-center gap-1 ${isCompact ? "text-[10px]" : "text-xs"}`}>
        <Button
          variant={richBody.styles.bold ? "default" : "outline"}
          size="sm"
          className={isCompact ? "h-6 min-w-6 px-2 text-[10px]" : "h-8 min-w-8 px-3 text-xs"}
          onClick={() =>
            onChangeRichBody({
              ...richBody,
              styles: { ...richBody.styles, bold: !richBody.styles.bold },
            })
          }
        >
          B
        </Button>

        <Button
          variant="outline"
          size="sm"
          className={isCompact ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs"}
          onClick={() =>
            onChangeRichBody({
              ...richBody,
              styles: { ...richBody.styles, size: cycleRichTextSize(richBody.styles.size) },
            })
          }
        >
          {richBody.styles.size.toUpperCase()}
        </Button>

        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1 py-1">
          {LOGBOOK_TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              title={`Color ${color}`}
              className={`h-4 w-4 rounded-full border ${
                richBody.styles.color === color ? "border-slate-900 ring-1 ring-slate-400" : "border-white/60"
              }`}
              style={{ backgroundColor: color }}
              onClick={() =>
                onChangeRichBody({
                  ...richBody,
                  styles: { ...richBody.styles, color },
                })
              }
            />
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-slate-200" />

        <Button
          variant="outline"
          size="sm"
          className={isCompact ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs"}
          onClick={onUndo}
          disabled={!canUndo}
        >
          Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={isCompact ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs"}
          onClick={onRedo}
          disabled={!canRedo}
        >
          Redo
        </Button>
      </div>

      <div className={`mt-2 flex flex-wrap items-center gap-1.5 ${isCompact ? "text-[10px]" : "text-xs"}`}>
        <span className="font-medium text-slate-500">Alarm</span>
        <Input
          type="datetime-local"
          value={toLocalDateTimeValue(remindAt)}
          onChange={(event) => onChangeRemindAt(fromLocalDateTimeValue(event.target.value))}
          className={isCompact ? "h-7 w-[174px] text-[10px]" : "h-9 w-[220px] text-xs"}
        />
        <Button
          variant="outline"
          size="sm"
          className={isCompact ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs"}
          onClick={() => onChangeRemindAt(null)}
        >
          Clear
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={isCompact ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs"}
          onClick={() => onChangeRemindAt(new Date(Date.now() + 30 * 60_000).toISOString())}
        >
          +30m
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={isCompact ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs"}
          onClick={() => onChangeRemindAt(new Date(Date.now() + 60 * 60_000).toISOString())}
        >
          +1h
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={isCompact ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs"}
          onClick={() => onChangeRemindAt(getTomorrowNineAm())}
        >
          Tomorrow 09:00
        </Button>
      </div>
    </div>
  )
}
