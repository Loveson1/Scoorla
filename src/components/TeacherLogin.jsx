import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AlertCircle, School, UserSquare2, KeyRound } from "lucide-react";
import { loginTeacherWithStaffCredentials } from "../utils/teacherAuthService";
import { loadSchoolDirectoryRecord } from "../utils/schoolDirectoryService";
import { logoutUser } from "../utils/authUtils";

export default function TeacherLogin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    schoolId: "",
    staffId: "",
    pin: "",
  });
  const [error, setError] = useState("");

  const handleChange = (event) => {
    const field = String(event.target.dataset.field || event.target.name || "").trim();
    const { value } = event.target;
    if (!field) return;
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedSchoolId = String(form.schoolId || "").trim().toLowerCase();
    if (!normalizedSchoolId || !form.staffId.trim() || !form.pin.trim()) {
      setError("Enter your School ID, Staff ID, and PIN.");
      return;
    }
    if (normalizedSchoolId.includes("@")) {
      setError("Use your School ID (e.g. impact-arena-academy), not an email address.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await loginTeacherWithStaffCredentials({
        schoolId: normalizedSchoolId,
        staffId: form.staffId,
        pin: form.pin,
      });
      const schoolRecord = await loadSchoolDirectoryRecord(result.schoolId || normalizedSchoolId);
      if (schoolRecord?.status === "disabled") {
        await logoutUser();
        setError("This school account is temporarily disabled. Contact support.");
        return;
      }
      try {
        localStorage.setItem("userId", result.uid);
      } catch {
        // no-op
      }

      navigate("/school-dashboard", { replace: true });
    } catch (loginError) {
      console.error("Teacher login failed:", loginError);
      const code = String(loginError?.code || "");
      if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
        setError("Invalid School ID, Staff ID, or PIN.");
      } else {
        setError(loginError?.message || "Failed to login as teacher.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center py-16 px-4">
      <div className="w-full max-w-[620px]">
        <div className="text-center mb-8 md:mb-12">
          <h1 className="text-2xl md:text-4xl font-bold text-black dark:text-white mb-3">
            Teacher Login
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm md:text-base">
            Access Scoorla with your staff credentials
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 md:p-8 border border-gray-200 dark:border-gray-700">
          {error && (
            <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="off">
            <div className="mb-4">
              <label htmlFor="schoolId" className="label-w mb-2 block">
                School ID
              </label>
              <div className="relative">
                <School className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="schoolId"
                  name="schoolSlug"
                  data-field="schoolId"
                  type="text"
                  value={form.schoolId}
                  onChange={handleChange}
                  placeholder="School ID (e.g. impact-arena-academy)"
                  className="input w-full !pl-12 !pr-3"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="mb-4">
              <label htmlFor="staffId" className="label-w mb-2 block">
                Staff ID
              </label>
              <div className="relative">
                <UserSquare2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="staffId"
                  name="staffCode"
                  data-field="staffId"
                  type="text"
                  value={form.staffId}
                  onChange={handleChange}
                  placeholder="STF-001"
                  className="input w-full !pl-12 !pr-3"
                  autoComplete="new-password"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="mb-6">
              <label htmlFor="pin" className="label-w mb-2 block">
                PIN
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  id="pin"
                  name="staffPin"
                  data-field="pin"
                  type="password"
                  value={form.pin}
                  onChange={handleChange}
                  maxLength={4}
                  placeholder="Enter your PIN"
                  className="input w-full !pl-12 !pr-3"
                  autoComplete="new-password"
                  inputMode="numeric"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="form-btn w-full bg-blue-800 text-white hover:bg-blue-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in..." : "Continue"}
            </button>
          </form>

          <div className="my-6 flex items-center gap-4">
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
            <span className="text-xs text-gray-500 dark:text-gray-400">or</span>
            <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
          </div>

          <button
            type="button"
            onClick={() => navigate("/login", { replace: true })}
            className="w-full rounded-lg border-2 border-gray-300 px-4 py-2 font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Login with Email
          </button>

          <p className="mt-5 text-center text-sm text-gray-600 dark:text-gray-300">
            Admin account?{" "}
            <Link to="/login" className="font-semibold text-blue-700 hover:underline dark:text-blue-400">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
