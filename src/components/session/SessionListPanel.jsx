export default function SessionListPanel({
  sessions = [],
  activeSessionId,
  selectedSessionId,
  onSetActive,
  onViewSession,
  onArchiveSession,
  isWorking = false,
}) {
  if (!sessions.length) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">
        No academic session is configured yet. Finish onboarding to bootstrap the first session.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session) => {
        const isActive = session.sessionId === activeSessionId || !!session?.isActive;
        const isSelected = session.sessionId === selectedSessionId;

        return (
          <div
            key={session.sessionId}
            className={`rounded-lg border p-4 transition-all ${
              isSelected
                ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20"
                : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/40"
            }`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold text-black dark:text-white">
                    {session.name || session.sessionId}
                  </p>
                  {isActive && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/40 dark:text-green-300">
                      Active
                    </span>
                  )}
                  {!isActive && (
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-200">
                      Inactive
                    </span>
                  )}
                  {session.isArchived && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Archived
                    </span>
                  )}
                  {(session.isArchived || session.isEditable === false) && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      Read-only
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  Terms: {session?.counts?.termCount || 0} | Enrollments:{" "}
                  {session?.counts?.enrollmentCount || 0} | Scores:{" "}
                  {session?.counts?.scoreCount || 0}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onViewSession(session)}
                  disabled={isWorking}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-black transition-all hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-500 dark:text-white dark:hover:bg-gray-600"
                >
                  {isSelected ? "Viewing" : "Open / View"}
                </button>
                {!isActive && !session.isArchived && (
                  <button
                    type="button"
                    onClick={() => onSetActive(session)}
                    disabled={isWorking}
                    className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    Set as Active
                  </button>
                )}
                {!session.isArchived && (
                  <button
                    type="button"
                    onClick={() => onArchiveSession(session)}
                    disabled={isWorking || isActive}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-700 dark:hover:bg-amber-600"
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
