import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, X, Lock, ArrowLeft } from "lucide-react";
import { verifyAdminPasscode, getAdminPasscodeHash } from "../utils/adminPasscodeUtils";
import { auth, firestore } from "../firebase";
import { doc, getDoc } from "firebase/firestore";

export default function AdminPasscodeModal({ onClose, onVerified }) {
  const navigate = useNavigate();
  const [passcode, setPasscode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [missingSchool, setMissingSchool] = useState(false);
  const MAX_ATTEMPTS = 5;

  const handleVerifyPasscode = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!passcode || passcode.trim().length === 0) {
        setError("Please enter the admin passcode");
        setLoading(false);
        return;
      }

      // Get current user
      const user = auth.currentUser;
      if (!user) {
        setError("User not authenticated. Please log in again.");
        setLoading(false);
        return;
      }

      // Get user's school ID from Firestore
      const userDocRef = doc(firestore, "users", user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        setMissingSchool(true);
        setError("Your account hasn't completed onboarding. You need to create a school first.");
        setLoading(false);
        return;
      }

      const userData = userDocSnap.data();
      const schoolId = userData?.schoolId;
      
      if (!schoolId) {
        setMissingSchool(true);
        setError("No school associated with this account. You need to create a school first.");
        setLoading(false);
        return;
      }

      // Get stored passcode hash
      const storedHash = await getAdminPasscodeHash(schoolId);
      if (!storedHash) {
        setError("Admin passcode not configured for this school.");
        setLoading(false);
        return;
      }

      // Verify passcode
      const isValid = await verifyAdminPasscode(passcode, storedHash);

      if (isValid) {
        // Store admin passcode verified status in sessionStorage (expires when tab closes)
        sessionStorage.setItem(`adminVerified_${user.uid}`, "true");
        console.log("✅ Passcode verified successfully");
        console.log("🔐 Admin verification stored in sessionStorage");
        
        // Clear form
        setPasscode("");
        setAttempts(0);
        setError("");
        
        // Call the onVerified callback to navigate to dashboard
        // This should happen immediately without delay
        onVerified();
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        if (newAttempts >= MAX_ATTEMPTS) {
          setError(
            `Maximum attempts (${MAX_ATTEMPTS}) exceeded. Please try again later.`
          );
        } else {
          setError(
            `Incorrect passcode. ${MAX_ATTEMPTS - newAttempts} attempts remaining.`
          );
        }
      }
    } catch (err) {
      console.error("Error verifying passcode:", err);
      setError("Error verifying passcode. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Disable submit if max attempts reached
  const isDisabled = attempts >= MAX_ATTEMPTS;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 w-full max-w-md">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X size={24} />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-full mb-4">
            <Lock size={24} className="text-purple-600 dark:text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            Admin Access
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Enter your school's admin passcode
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex gap-3">
            <AlertCircle
              size={20}
              className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
            />
            <div className="flex-1">
              <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
              {missingSchool && (
                <button
                  onClick={() => {
                    onClose();
                    navigate("/school", { replace: true });
                  }}
                  className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm font-medium flex items-center gap-1 mt-2"
                >
                  <ArrowLeft size={14} /> Create School Now
                </button>
              )}
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleVerifyPasscode} className="space-y-4">
          {/* Passcode Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Admin Passcode
            </label>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="Enter 6-digit passcode"
              maxLength="6"
              disabled={loading || isDisabled}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed text-center tracking-widest text-2xl"
            />
          </div>

          {/* Attempt Counter */}
          {attempts > 0 && (
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
              Attempts: {attempts} / {MAX_ATTEMPTS}
            </p>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || isDisabled || !passcode}
            className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white font-medium rounded-lg transition-colors duration-200"
          >
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>

        {/* Info */}
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-6">
          This is a secure second layer. Contact your school administrator if you don't
          have the passcode.
        </p>
      </div>
    </div>
  );
}
