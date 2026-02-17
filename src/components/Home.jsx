// src/pages/Home.jsx
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    // Users who reach here are authenticated and onboarded
    // Automatically redirect to the main dashboard (school-dashboard)
    navigate("/school-dashboard", { replace: true });
  }, [navigate]);

  return (
    <div className="flex justify-center bg-white dark:bg-gray-900 min-h-screen">
      <div className="flex flex-col items-center justify-center h-[70vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-700 dark:text-gray-300">Redirecting to dashboard...</p>
      </div>
    </div>
  );
}
