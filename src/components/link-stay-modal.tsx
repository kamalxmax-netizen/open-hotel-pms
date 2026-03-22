"use client";

import { useState, useCallback, useRef } from "react";

interface LinkStayModalProps {
  /** The reservation we want to link FROM (will be the parent) */
  reservationId: string;
  guestName: string;
  checkinDate: string;
  checkoutDate: string;
  onClose: () => void;
  onSuccess: () => void;
}

type SearchResult = {
  id: string;
  booking_code: string | null;
  guest_name: string | null;
  checkin_date: string;
  checkout_date: string;
  source: string | null;
  status: string | null;
  room_number?: string | null;
};

export default function LinkStayModal({
  reservationId,
  guestName,
  checkinDate,
  checkoutDate,
  onClose,
  onSuccess,
}: LinkStayModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [linkNote, setLinkNote] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }
      setSearching(true);
      setSearchError("");
      try {
        const res = await fetch(
          `/api/reservations?q=${encodeURIComponent(query.trim())}&limit=20&status=active`
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setSearchError(data?.error || "Search failed.");
          return;
        }
        // Filter out self
        const filtered = (data?.reservations ?? data ?? []).filter(
          (r: SearchResult) => String(r.id) !== reservationId
        );
        setResults(filtered);
      } catch (err) {
        setSearchError(String(err));
      } finally {
        setSearching(false);
      }
    },
    [reservationId]
  );

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    setSelectedId(null);
    setLinkError("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 400);
  }

  async function handleLink() {
    if (!selectedId) return;
    setLinking(true);
    setLinkError("");

    try {
      const res = await fetch(
        `/api/bookings/${reservationId}/link-stay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            child_reservation_id: selectedId,
            note: linkNote.trim() || null,
          }),
        }
      );
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        setLinkError(data?.error || "Failed to link reservations.");
        return;
      }

      onSuccess();
      onClose();
    } catch (err) {
      setLinkError(String(err));
    } finally {
      setLinking(false);
    }
  }

  const selectedResult = results.find((r) => r.id === selectedId);

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Link to Another Booking
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {guestName} · {checkinDate} → {checkoutDate}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="mt-3 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search by guest name, booking code, or phone..."
                className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                autoFocus
              />
              {searching && (
                <div className="absolute right-3 top-2.5">
                  <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
            {searchError && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">
                {searchError}
              </p>
            )}

            {results.length === 0 && searchQuery.length >= 2 && !searching && (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-8">
                No matching reservations found.
              </p>
            )}

            {results.length === 0 && searchQuery.length < 2 && (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-8">
                Type at least 2 characters to search...
              </p>
            )}

            <div className="space-y-1.5">
              {results.map((r) => {
                const isSelected = r.id === selectedId;
                const sourceCode = String(r.source ?? "").toLowerCase();
                const sourceLabel =
                  sourceCode === "walkin"
                    ? "Walk-in"
                    : sourceCode
                      ? sourceCode.toUpperCase()
                      : "—";

                // Check contiguity with current reservation
                const isContiguous =
                  r.checkin_date === checkoutDate ||
                  r.checkout_date === checkinDate;

                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(isSelected ? null : r.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                      isSelected
                        ? "bg-indigo-50 border-indigo-300 shadow-sm dark:bg-indigo-500/10 dark:border-indigo-500/50"
                        : "bg-white border-slate-100 hover:bg-slate-50 hover:border-slate-200 dark:bg-slate-800/50 dark:border-slate-700 dark:hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {r.guest_name || "—"}
                        </span>
                        {r.booking_code && (
                          <span className="ml-2 text-xs text-slate-400 dark:text-slate-500 font-mono">
                            {r.booking_code}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {sourceLabel}
                        </span>
                        {r.room_number && (
                          <span className="text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded font-mono">
                            {r.room_number}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {r.checkin_date} → {r.checkout_date}
                      </span>
                      {isContiguous ? (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                          Contiguous dates
                        </span>
                      ) : (
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                          Non-contiguous
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer: Confirm link */}
          <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800">
            {linkError && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-2 font-medium">
                {linkError}
              </p>
            )}

            {selectedResult && (
              <div className="mb-3 p-2.5 bg-indigo-50/50 dark:bg-indigo-500/5 rounded-lg border border-indigo-100 dark:border-indigo-500/20">
                <p className="text-xs text-indigo-700 dark:text-indigo-300 font-medium">
                  Link: {guestName} ({checkinDate} → {checkoutDate}) + {selectedResult.guest_name} ({selectedResult.checkin_date} → {selectedResult.checkout_date})
                </p>
                <input
                  type="text"
                  value={linkNote}
                  onChange={(e) => setLinkNote(e.target.value)}
                  placeholder="Note (optional)..."
                  className="mt-2 w-full px-2 py-1 text-xs border border-indigo-200 dark:border-indigo-500/30 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder:text-slate-400"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-all dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLink}
                disabled={!selectedId || linking}
                className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 border border-indigo-700 rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {linking ? "Linking..." : "Link Reservations"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
