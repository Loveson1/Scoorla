import { useNavigate } from "react-router-dom";
import { logoutUser } from "../utils/authUtils";
import { LogOut, AlertCircle } from "lucide-react";

export default function LogoutConfirm({ isOpen, onClose, onConfirm }) {
  const navigate = useNavigate();
  const handleLogout = async () => {
    try {
      await logoutUser();
      onConfirm?.();
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
      alert("Error logging out. Please try again.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 md:p-8 max-w-[400px] border border-gray-200 dark:border-gray-700 animate-fadeIn">
        {/* Alert Icon */}
        <div className="mb-4 flex justify-center">
          <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-orange-600 dark:text-orange-400" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-black dark:text-white mb-3 text-center">
          Sign Out?
        </h2>

        {/* Message */}
        <p className="text-gray-600 dark:text-gray-300 text-center mb-8">
          Are you sure you want to sign out? You'll need to sign in again to access your school dashboard.
        </p>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleLogout}
            className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
