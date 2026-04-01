import { useEffect, useState } from "react";

export default function CreateSessionModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
}) {
  const [sessionName, setSessionName] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setSessionName("");
  }, [isOpen]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = String(sessionName || "").trim();
    if (!trimmed) {
      alert("Session name is required");
      return;
    }
    const parsed = trimmed.match(/^(\d{4})\s*\/\s*(\d{4})$/);
    if (!parsed) {
      alert("Use format YYYY/YYYY (example: 2025/2026).");
      return;
    }
    const startYear = Number(parsed[1]);
    const endYear = Number(parsed[2]);
    if (endYear !== startYear + 1) {
      alert("Session years must be consecutive.");
      return;
    }
    if (startYear < 2025) {
      alert("Session must be 2025/2026 or later.");
      return;
    }

    await onSubmit(trimmed);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-black dark:text-white">
            Create Academic Session
          </h3>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            type="button"
            disabled={isSubmitting}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-black dark:text-white">
              Session Name
            </label>
            <input
              value={sessionName}
              onChange={(event) => setSessionName(event.target.value)}
              className="input w-full"
              placeholder="e.g., 2026/2027"
              disabled={isSubmitting}
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Use format YYYY/YYYY, from 2025/2026 upward. Terms are optional and can be added later.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 rounded-lg border-2 border-gray-300 px-4 py-2 font-semibold text-black transition-all duration-300 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-lg bg-blue-800 px-4 py-2 font-semibold text-white transition-all duration-300 hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
            >
              {isSubmitting ? "Creating..." : "Create Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
