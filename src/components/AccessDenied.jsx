import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

export default function AccessDenied() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <ShieldAlert className="h-8 w-8 text-red-600 dark:text-red-300" />
        </div>
        <h1 className="mb-3 text-2xl font-bold text-black dark:text-white">Access Denied</h1>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-300">
          You are not assigned to this resource.
        </p>
        <button
          type="button"
          onClick={() => navigate("/school-dashboard", { replace: true })}
          className="rounded-lg bg-blue-800 px-5 py-2 font-semibold text-white transition-colors hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600"
        >
          Go To Dashboard
        </button>
      </div>
    </div>
  );
}

