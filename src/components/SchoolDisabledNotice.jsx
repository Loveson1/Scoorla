import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { logoutUser } from "../utils/authUtils";

export default function SchoolDisabledNotice() {
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logoutUser();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-white px-4 py-16 dark:bg-gray-900">
      <div className="mx-auto max-w-2xl rounded-3xl border border-red-200 bg-red-50 p-8 shadow-lg dark:border-red-900/30 dark:bg-red-900/10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-red-700 dark:text-red-300">
          Account Status
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-black dark:text-white">
          School Access Disabled
        </h1>
        <p className="mt-4 text-sm leading-7 text-gray-700 dark:text-gray-300">
          This school account is temporarily disabled. Contact support before trying to use the
          dashboard again.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-5 py-3 font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-70"
          >
            {isLoggingOut && <Loader2 className="h-4 w-4 animate-spin" />}
            {isLoggingOut ? "Signing Out..." : "Sign Out"}
          </button>
          <a
            href="/teacher-login"
            className="rounded-lg border border-gray-300 px-5 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Back to Login Options
          </a>
        </div>
      </div>
    </div>
  );
}
