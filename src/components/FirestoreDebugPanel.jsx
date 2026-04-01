import { useEffect, useMemo, useState } from "react";
import {
  FIRESTORE_DEBUG_EVENT_NAME,
  getFirestoreMetricsSnapshot,
  isFirestoreDebugEnabled,
  resetFirestoreMetrics,
} from "../services/firestoreInstrumentation";

const formatTime = (timestamp) => {
  const date = new Date(Number(timestamp) || 0);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString();
};

export default function FirestoreDebugPanel() {
  const [snapshot, setSnapshot] = useState(() => getFirestoreMetricsSnapshot());
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isFirestoreDebugEnabled()) return undefined;

    const sync = () => {
      setSnapshot(getFirestoreMetricsSnapshot());
    };
    sync();
    window.addEventListener(FIRESTORE_DEBUG_EVENT_NAME, sync);
    return () => window.removeEventListener(FIRESTORE_DEBUG_EVENT_NAME, sync);
  }, []);

  const recentOperations = useMemo(
    () => snapshot.operations.slice(0, 8),
    [snapshot.operations]
  );

  if (!snapshot.enabled) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[120]">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg"
        >
          FS Debug ({snapshot.reads}R / {snapshot.writes}W)
        </button>
      ) : (
        <div className="w-80 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold text-white">Firestore Debug</p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-200"
            >
              Close
            </button>
          </div>

          <div className="mb-2 grid grid-cols-2 gap-2">
            <div className="rounded bg-slate-800 px-2 py-1">
              <p className="text-[10px] uppercase text-slate-400">Reads</p>
              <p className="font-semibold text-white">{snapshot.reads}</p>
            </div>
            <div className="rounded bg-slate-800 px-2 py-1">
              <p className="text-[10px] uppercase text-slate-400">Writes</p>
              <p className="font-semibold text-white">{snapshot.writes}</p>
            </div>
          </div>

          <div className="mb-2 max-h-48 space-y-1 overflow-y-auto rounded bg-slate-950 p-2">
            {recentOperations.length === 0 ? (
              <p className="text-slate-400">No operations captured yet.</p>
            ) : (
              recentOperations.map((row, index) => (
                <p key={`${row.at}-${index}`} className="text-[11px] text-slate-300">
                  {formatTime(row.at)} • {row.screen} • {row.action} • {row.count}
                </p>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              resetFirestoreMetrics();
              setSnapshot(getFirestoreMetricsSnapshot());
            }}
            className="w-full rounded bg-blue-700 px-3 py-1.5 font-semibold text-white hover:bg-blue-600"
          >
            Reset Metrics
          </button>
        </div>
      )}
    </div>
  );
}

