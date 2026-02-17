import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle } from "lucide-react";

export default function OnboardingSuccess() {
  const navigate = useNavigate();

  useEffect(() => {
    // Auto-redirect after 3 seconds if user doesn't click button
    const timer = setTimeout(() => {
      navigate("/school-dashboard");
    }, 3000);

    return () => clearTimeout(timer);
  }, [navigate]);

  const handleContinue = () => {
    navigate("/school-dashboard");
  };

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 md:p-12 max-w-[500px] text-center border border-gray-200 dark:border-gray-700 animate-fadeIn">
        {/* Success Icon */}
        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center animate-bounce">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
        </div>

        {/* Congratulations Message */}
        <h2 className="text-3xl md:text-4xl font-bold text-black dark:text-white mb-4">
          Success! 🎉
        </h2>

        {/* Description */}
        <div className="mb-8">
          <p className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
            Your school is ready on Scoorla!
          </p>
          <p className="text-gray-600 dark:text-gray-400">
            You're all set to start managing student results with ease. Let's get started with your first class.
          </p>
        </div>

        {/* Info Box */}
        <div className="mb-8 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <strong>Next steps:</strong>
            <ul className="list-disc list-inside mt-2 text-xs space-y-1">
              <li>Add your classes and students</li>
              <li>Configure grading scales (optional)</li>
              <li>Start recording results</li>
            </ul>
          </p>
        </div>

        {/* Continue Button */}
        <button
          onClick={handleContinue}
          className="form-btn w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold py-3 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
        >
          Go to Dashboard
        </button>

        {/* Auto-redirect Message */}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
          Redirecting automatically in 3 seconds...
        </p>
      </div>
    </div>
  );
}
