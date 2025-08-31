import { useState, useEffect } from "react";
import { Sun, Moon, Menu } from "lucide-react"; // icons

export default function Navbar({ onMenuClick }) {
  const [darkMode, setDarkMode] = useState(false);

  // toggle dark mode
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  return (
    <header className="flex items-center justify-between  py-2 bg-white dark:bg-gray-900 shadow mb-10" >
      {/* Left: Logo */}
      <div className="flex items-center gap-2">
        <button className="" onClick={onMenuClick}>
          <Menu className="w-6 h-6 text-gray-700 dark:text-gray-200" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          Mini Board
        </h1>
        
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-4">
        {/* Dark mode toggle */}
        <button onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? (
            <Sun className="w-6 h-6 text-yellow-400" />
          ) : (
            <Moon className="w-6 h-6 text-gray-700 dark:text-gray-200" />
          )}
        </button>

        {/* Profile DP (placeholder) */}
        <img
          src="./assets/dp.png"
          alt="profile"
          className="w-10 h-10 rounded-full border"
        />
      </div>
    </header>
  );
}
