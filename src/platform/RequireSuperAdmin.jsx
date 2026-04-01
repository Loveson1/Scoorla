import { Navigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuthContext } from "../context/AuthContext";

export default function RequireSuperAdmin({ children }) {
  const { authUser, isLoading, isPlatformSuperAdmin } = useAuthContext();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-400"></div>
          <p className="mt-4 text-sm text-slate-300">Verifying platform access...</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <Navigate to="/platform/login" replace />;
  }

  if (!isPlatformSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-300">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-white">Access Denied</h1>
          <p className="mt-3 text-sm text-slate-300">
            This account does not have platform-level permissions.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a
              href="/school-dashboard"
              className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white transition-colors hover:bg-blue-600"
            >
              Go to School App
            </a>
            <a
              href="/login"
              className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-200 transition-colors hover:bg-slate-800"
            >
              Back to Login
            </a>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
