import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Copy, Check, AlertTriangle, ChevronRight } from "lucide-react";

export default function AdminPasscodeSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const [copied, setCopied] = useState(false);

  // Get passcode from navigation state
  const passcode = location.state?.passcode;
  const schoolName = location.state?.schoolName;

  // If no passcode provided, redirect to school creation
  React.useEffect(() => {
    if (!passcode) {
      navigate("/school", { replace: true });
    }
  }, [passcode, navigate]);

  const handleCopyPasscode = () => {
    navigator.clipboard.writeText(passcode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = () => {
    // Navigate to role selection after viewing passcode
    navigate("/select-role", { replace: true });
  };

  if (!passcode) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-purple-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl overflow-hidden">
          {/* Warning Banner */}
          <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 p-4 flex gap-3">
            <AlertTriangle
              size={24}
              className="text-red-600 dark:text-red-400 flex-shrink-0"
            />
            <div>
              <h3 className="font-semibold text-red-900 dark:text-red-400">
                ⚠️ Important
              </h3>
              <p className="text-sm text-red-800 dark:text-red-300 mt-1">
                Save your Admin Passcode now. You won't see it again!
              </p>
            </div>
          </div>

          {/* Content */}
          <div className="p-8 text-center">
            {/* Icon */}
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 dark:bg-purple-900 rounded-full mb-6">
              <span className="text-3xl">🔐</span>
            </div>

            {/* Title */}
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Admin Passcode Generated
            </h1>

            {/* School Name */}
            {schoolName && (
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                for <strong>{schoolName}</strong>
              </p>
            )}

            {/* Passcode Display */}
            <div className="mb-8">
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3">
                Your Admin Passcode:
              </p>
              <div className="relative bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-200 dark:border-purple-800 rounded-lg p-6 mb-4">
                <code className="text-4xl font-bold text-purple-600 dark:text-purple-400 tracking-widest">
                  {passcode}
                </code>
              </div>

              {/* Copy Button */}
              <button
                onClick={handleCopyPasscode}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors text-sm font-medium"
              >
                {copied ? (
                  <>
                    <Check size={18} /> Copied!
                  </>
                ) : (
                  <>
                    <Copy size={18} /> Copy Passcode
                  </>
                )}
              </button>
            </div>

            {/* Instructions */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-8 text-left">
              <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-3">
                How to use this passcode:
              </h3>
              <ol className="text-sm text-blue-800 dark:text-blue-400 space-y-2">
                <li>
                  <strong>1. Save it securely</strong> - Write it down or store in password manager
                </li>
                <li>
                  <strong>2. Share with admins</strong> - Give only to authorized staff
                </li>
                <li>
                  <strong>3. Use for admin access</strong> - Required to access admin dashboard
                </li>
                <li>
                  <strong>4. Change anytime</strong> - You can reset it in admin settings
                </li>
              </ol>
            </div>

            {/* Confirmation Checkbox */}
            <div className="mb-8">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="iSaved"
                  className="mt-1 w-4 h-4 rounded border-gray-300 text-purple-600 cursor-pointer"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  I have saved my Admin Passcode in a secure location
                </span>
              </label>
            </div>

            {/* Continue Button */}
            <button
              onClick={handleContinue}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              Continue to Dashboard
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Security Note */}
          <div className="bg-gray-50 dark:bg-gray-700 px-8 py-4 text-center border-t border-gray-200 dark:border-gray-600">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              🔒 This passcode is hashed and stored securely. Never share it via email or
              unencrypted messages.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
