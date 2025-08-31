// src/components/Layout.jsx
import { useState } from "react";
import Navbar from "./Navbar";
import Sidebar from "./Sidebar";
import { Outlet } from "react-router-dom";

export default function Layout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900">
     <div className=" py-3 px-12">
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
        <main className="flex-1 p-6">
          <Outlet /> {/* renders Home, Users, etc. */}
        </main>
      </div>
    </div>
  );
}
