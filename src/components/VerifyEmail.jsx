import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Mail, CheckCircle, AlertCircle, RotateCcw } from "lucide-react";
import { getCurrentUser } from "../utils/authUtils";
import {
  sendVerificationEmail,
  checkEmailVerification,
} from "../utils/authUtils";

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || "");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Get email from current user if not in state
  useEffect(() => {
    const user = getCurrentUser();
    if (user && !email) {
      setEmail(user.email);
    }
  }, [email]);

  // Check verification status periodically
  useEffect(() => {
    const interval = setInterval(async () => {
      const isVerified = await checkEmailVerification();
      if (isVerified) {
        setVerified(true);
      }
    }, 3000); // Check every 3 seconds

    return () => clearInterval(interval);
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleResendEmail = async () => {
    try {
      setLoading(true);
      setError("");
      setSuccessMessage("");

      await sendVerificationEmail();

      setSuccessMessage("Verification email sent! Check your inbox.");
      setResendCooldown(60); // 60 second cooldown
    } catch (err) {
      console.error("Error resending verification email:", err);
      setError(
        "Failed to resend verification email. Please try again later."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshStatus = async () => {
    try {
      setChecking(true);
      const isVerified = await checkEmailVerification();
      if (isVerified) {
        setVerified(true);
        setSuccessMessage("Email verified successfully! Redirecting...");
        
        setTimeout(() => {
          // Always go to welcome after email verification
          // Welcome page will handle the onboarding flow
          navigate("/welcome");
        }, 2000);
      } else {
        setError("Email not verified yet. Please check your inbox.");
      }
    } catch (err) {
      console.error("Error checking verification:", err);
      setError("Failed to check verification status. Please try again.");
    } finally {
      setChecking(false);
    }
  };

  // Auto-redirect if verified
  useEffect(() => {
    if (verified) {
      const timer = setTimeout(() => {
        // Always go to welcome after email verification
        navigate("/welcome");
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [verified, navigate]);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-[620px]">
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <div className="flex justify-center mb-6">
            {verified ? (
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
            ) : (
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                <Mail className="w-10 h-10 text-blue-600 dark:text-blue-400" />
              </div>
            )}
          </div>

          <h1 className="text-2xl md:text-4xl font-bold text-black dark:text-white mb-3">
            {verified ? "Email Verified!" : "Verify Your Email"}
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm md:text-base">
            {verified
              ? "Your email has been verified. Setting up your dashboard..."
              : "Please verify your email address to access Scoorla"}
          </p>
        </div>

        {/* Content Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 md:p-8 border border-gray-200 dark:border-gray-700">
          {/* Success Message */}
          {successMessage && (
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-green-700 dark:text-green-300 text-sm font-medium">
                {successMessage}
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 dark:text-red-300 text-sm font-medium">
                {error}
              </p>
            </div>
          )}

          {!verified && (
            <>
              {/* Email Display */}
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Verification email sent to:
                </p>
                <p className="text-lg font-semibold text-blue-900 dark:text-blue-200 break-all">
                  {email}
                </p>
              </div>

              {/* Instructions */}
              <div className="mb-8 space-y-3">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  What to do next:
                </h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 dark:text-gray-300">
                  <li>
                    <span className="ml-2">
                      Check your inbox for an email from Scoorla
                    </span>
                  </li>
                  <li>
                    <span className="ml-2">
                      Click the verification link in the email
                    </span>
                  </li>
                  <li>
                    <span className="ml-2">
                      Return here and click "Refresh Status"
                    </span>
                  </li>
                  <li>
                    <span className="ml-2">
                      You'll be redirected to complete your school setup
                    </span>
                  </li>
                </ol>
              </div>

              {/* Why Verification Section */}
              <div className="mb-8 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
                  Why verify?
                </h3>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Email verification ensures your account is secure and you have
                  access to your registered email. This protects your school's
                  sensitive data.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={handleRefreshStatus}
                  disabled={checking}
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                >
                  {checking ? "Checking..." : "Refresh Status"}
                </button>

                <button
                  onClick={handleResendEmail}
                  disabled={loading || resendCooldown > 0}
                  className="w-full px-4 py-3 border-2 border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 font-semibold rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>
                    {loading
                      ? "Sending..."
                      : resendCooldown > 0
                        ? `Resend in ${resendCooldown}s`
                        : "Resend Email"}
                  </span>
                </button>
              </div>
            </>
          )}

          {verified && (
            <div className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <p className="text-green-800 dark:text-green-200 text-center font-medium">
                  ✓ Email verified successfully!
                </p>
              </div>
              <p className="text-center text-gray-600 dark:text-gray-400">
                Redirecting to complete your school setup...
              </p>
            </div>
          )}
        </div>

        {/* Help Section */}
        <div className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          <p>
            Didn't receive the email?
            <br />
            Check your spam folder or{" "}
            <button
              onClick={handleResendEmail}
              disabled={resendCooldown > 0}
              className="text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              try resending
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
