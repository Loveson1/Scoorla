// src/components/Layout.jsx
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import { Outlet } from "react-router-dom";

export default function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-[100vh]  flex flex-col bg-white dark:bg-gray-900">
      <div className=" ">
        {/* Navbar */}
        <Navbar onMenuClick={() => setIsSidebarOpen(true)} />
      </div>
      <div className="flex flex-1">
        {/* Sidebar */}
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />

        {/* Main Content */}
        <main className=" flex-1 overflow-x-hidden">
          <Outlet /> 
        </main>
      </div>
    </div>
  );
}
