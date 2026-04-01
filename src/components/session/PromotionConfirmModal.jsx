export default function PromotionConfirmModal({
  isOpen,
  sourceSession,
  nextSessionName,
  sessions = [],
  activeSessionId,
  targetSession,
  selectedTargetSessionId,
  onTargetSessionChange,
  impact,
  isSubmitting = false,
  onCancel,
  onConfirm,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <h3 className="mb-5 text-xl font-semibold text-black dark:text-white">
          Confirm Promotion
        </h3>

        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
          <p className="text-sm text-black dark:text-white">
            <span className="font-semibold">Source Session:</span>{" "}
            {sourceSession?.name || sourceSession?.sessionId || "N/A"}
          </p>
          <p className="text-sm text-black dark:text-white">
            <span className="font-semibold">Target Session:</span>{" "}
            {nextSessionName || targetSession?.name || targetSession?.sessionId || "N/A"}
          </p>
          {!nextSessionName && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-black dark:text-white">
                Select Promotion Target
              </label>
              <select
                className="input w-full"
                value={selectedTargetSessionId || ""}
                onChange={(event) => onTargetSessionChange?.(event.target.value)}
                disabled={isSubmitting}
              >
                <option value="">Select target session</option>
                {sessions
                  .filter(
                    (session) =>
                      session?.sessionId &&
                      session.sessionId !== activeSessionId &&
                      !session?.isArchived
                  )
                  .map((session) => (
                    <option key={session.sessionId} value={session.sessionId}>
                      {session.name || session.sessionId}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <p className="text-sm text-black dark:text-white">
            <span className="font-semibold">Total Enrollments:</span>{" "}
            {impact?.counts?.totalEnrollments || 0}
          </p>
          <p className="text-sm text-black dark:text-white">
            <span className="font-semibold">Promotable Students:</span>{" "}
            {impact?.counts?.promotable || 0}
          </p>
          <p className="text-sm text-black dark:text-white">
            <span className="font-semibold">Class Groups:</span>{" "}
            {impact?.classSummary?.length || 0}
          </p>
          {Array.isArray(impact?.classSummary) && impact.classSummary.length > 0 && (
            <div className="rounded border border-amber-200 bg-white/70 p-2 text-xs dark:border-amber-700 dark:bg-gray-900/30">
              <p className="mb-1 font-semibold text-black dark:text-white">Class Mapping Preview</p>
              <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                {impact.classSummary.slice(0, 10).map((row) => (
                  <p key={row.classId} className="text-gray-700 dark:text-gray-200">
                    {row.classId}: {row.total || 0} student(s), next class:{" "}
                    <span className="font-semibold">{row.nextClassId || "Not found"}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
          {Number(impact?.counts?.promotable || 0) === 0 &&
            Number(impact?.counts?.totalEnrollments || 0) > 0 && (
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                No next-class mapping found for current class IDs. Check class naming/setup.
              </p>
            )}
          <p className="pt-1 text-sm font-semibold text-red-700 dark:text-red-400">
            Warning: This action is irreversible.
          </p>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 rounded-lg border-2 border-gray-300 px-4 py-2 font-semibold text-black transition-all duration-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting || (!nextSessionName && !selectedTargetSessionId)}
            className="flex-1 rounded-lg bg-green-600 px-4 py-2 font-semibold text-white transition-all duration-300 hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-green-700 dark:hover:bg-green-600"
          >
            {isSubmitting ? "Promoting..." : "Confirm Promotion"}
          </button>
        </div>
      </div>
    </div>
  );
}
