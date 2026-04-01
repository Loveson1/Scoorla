import { useState, useEffect } from "react";
import { Sun, Moon, Menu, GraduationCap, LogOut } from "lucide-react";
import LogoutConfirm from "./LogoutConfirm";
import { isUserAuthenticated } from "../utils/authUtils";
import { useSchoolBootstrap } from "../context/SchoolBootstrapContext";

export default function Navbar({ onMenuClick }) {
  const [darkMode, setDarkMode] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const isAuthenticated = isUserAuthenticated();
  const { schoolData } = useSchoolBootstrap();

  // toggle dark mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  return (
    <>
      <header className="flex items-center justify-between px-6 md:px-12 py-4 md:py-5 bg-gradient-to-r from-blue-800 to-blue-900 dark:from-gray-900 dark:to-gray-800 shadow-lg">
        {/* Left: Logo & Brand */}
        <div className="flex items-center gap-3">
          <button className="p-2 hover:bg-blue-700 dark:hover:bg-gray-700 rounded-lg transition-colors" onClick={onMenuClick}>
            <Menu className="w-5 h-5 text-white" />
          </button>
          <div className="flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-blue-200" />
            <h1 className="text-lg md:text-xl font-bold text-white hidden sm:block">
              Scoorla
            </h1>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-4">
          {/* Dark mode toggle */}
          <button 
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 hover:bg-blue-700 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Toggle dark mode"
          >
            {darkMode ? (
              <Sun className="w-5 h-5 text-yellow-300" />
            ) : (
              <Moon className="w-5 h-5 text-blue-100" />
            )}
          </button>

          {/* School Logo Avatar */}
          <div className="w-9 h-9 rounded-full border-2 border-blue-200 hover:border-blue-100 transition-colors overflow-hidden bg-blue-100 dark:bg-gray-700 flex items-center justify-center">
            {schoolData.logo ? (
              <img
                src={schoolData.logo}
                alt={schoolData.name}
                className="w-full h-full object-cover"
                title={schoolData.name}
              />
            ) : (
              <span className="text-xs font-bold text-blue-800 dark:text-blue-300">
                {schoolData.name ? schoolData.name.charAt(0).toUpperCase() : "S"}
              </span>
            )}
          </div>

          {/* Logout Button */}
          {isAuthenticated && (
            <button
              onClick={() => setShowLogoutModal(true)}
              className="p-2 hover:bg-blue-700 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Sign out"
            >
              <LogOut className="w-5 h-5 text-blue-100" />
            </button>
          )}
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      <LogoutConfirm
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => setShowLogoutModal(false)}
      />
    </>
  );
}
