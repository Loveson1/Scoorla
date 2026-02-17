import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase";
import { ArrowLeft } from "lucide-react";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState("");

  const handleChange = (e) => {
    setEmail(e.target.value);
    // Clear error when user starts typing
    if (error) {
      setError("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Basic validation
    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Send password reset email
      await sendPasswordResetEmail(auth, email);

      setSuccess(true);
      setEmail("");
    } catch (err) {
      setLoading(false);
      if (err.code === "auth/user-not-found") {
        setError(
          "No account found with this email. Please check and try again or create a new account."
        );
      } else if (err.code === "auth/invalid-email") {
        setError("Invalid email format. Please check and try again.");
      } else if (err.code === "auth/too-many-requests") {
        setError(
          "Too many requests. Please wait a moment and try again later."
        );
      } else {
        setError(
          "Failed to send reset email. Please try again or contact support."
        );
      }
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="w-full max-w-[620px]">
          {/* Success Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 md:p-12 text-center border border-green-200 dark:border-green-800">
            {/* Success Icon */}
            <div className="mb-6 flex justify-center">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-green-600 dark:text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>

            {/* Success Message */}
            <h2 className="text-2xl md:text-3xl font-bold text-black dark:text-white mb-4">
              Check Your Email
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mb-2">
              We've sent a password reset link to:
            </p>
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-400 mb-6">
              {email || "your email address"}
            </p>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-8 text-left">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <strong>What's next?</strong>
                <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                  <li>Check your email inbox for our message</li>
                  <li>Click the password reset link in the email</li>
                  <li>Create a new password for your account</li>
                  <li>Sign in with your email and new password</li>
                </ul>
              </p>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
              If you don't see the email, check your spam or junk folder. The link
              expires in 1 hour.
            </p>

            {/* Back to Login Button */}
            <button
              onClick={() => navigate("/login")}
              className="form-btn w-full bg-blue-800 hover:bg-blue-900 text-white font-bold py-3 rounded-lg transition-colors duration-200"
            >
              Back to Sign In
            </button>
          </div>

          {/* Contact Support */}
          <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400">
            <p>
              Didn't receive an email?{" "}
              <a
                href="mailto:support@scoorla.com"
                className="text-blue-800 dark:text-blue-400 hover:underline"
              >
                Contact support
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-[620px]">
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <h1 className="text-2xl md:text-4xl font-bold text-black dark:text-white mb-3">
            Reset Your Password
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm md:text-base">
            Don't worry! We'll help you get back into your account.
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 md:p-8 border border-gray-200 dark:border-gray-700">
          <form onSubmit={handleSubmit}>
            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
                <p className="text-red-700 dark:text-red-300 text-sm font-medium">
                  {error}
                </p>
              </div>
            )}

            {/* Info Box */}
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Enter the email address associated with your school account, and
                we'll send you a link to reset your password.
              </p>
            </div>

            {/* Email Field */}
            <div className="mb-6">
              <label htmlFor="email" className="label-w block mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={handleChange}
                placeholder="your.email@school.com"
                className="input w-full focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                We'll send a reset link here
              </p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="form-btn w-full bg-blue-800 hover:bg-blue-900 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-colors duration-200"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="w-4 h-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Sending...
                </span>
              ) : (
                "Send Reset Link"
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-4">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
            <span className="text-sm text-gray-500 dark:text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
          </div>

          {/* Back to Login */}
          <button
            onClick={() => navigate("/login")}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 border-2 border-blue-800 dark:border-blue-600 text-blue-800 dark:text-blue-400 font-semibold rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Sign In
          </button>
        </div>

        {/* Footer Info */}
        <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400">
          <p>
            Remember your password?{" "}
            <Link
              to="/login"
              className="text-blue-800 dark:text-blue-400 hover:underline"
            >
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
