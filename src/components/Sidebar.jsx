import { X, BookOpen, Settings, BarChart3, FolderOpen, Lock, LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import LogoutConfirm from "./LogoutConfirm";
import { useAuthContext } from "../context/AuthContext";

export default function Sidebar({ isOpen, onClose }) {
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const { role, isAdmin } = useAuthContext();

  const baseNavItems = [
    {
      id: "school-dashboard",
      icon: BookOpen,
      label: "Dashboard",
      href: "/school-dashboard",
      color: "text-green-600 dark:text-green-400",
    },
    {
      id: "classes",
      icon: FolderOpen,
      label: "Classes",
      href: "/class-dashboard",
      color: "text-indigo-600 dark:text-indigo-400",
    },
    {
      id: "records",
      icon: BarChart3,
      label: "Records",
      href: "/record-dashboard",
      color: "text-purple-600 dark:text-purple-400",
    },
  ];

  const adminNavItem = {
    id: "admin-settings",
    icon: Settings,
    label: "Admin Settings",
    href: "/admin-config",
    color: "text-orange-600 dark:text-orange-400",
  };

  const roleAllowsItem = (itemId) => {
    if (role === "class_teacher") return itemId === "school-dashboard" || itemId === "classes";
    if (role === "subject_teacher") return itemId === "school-dashboard" || itemId === "records";
    return true;
  };

  const navItems = isAdmin ? [...baseNavItems, adminNavItem] : baseNavItems;
  const getNavTarget = (item) => {
    if (item.id === "classes" || item.id === "records") {
      return "/school-dashboard";
    }
    return item.href;
  };
  const getNavState = (item) => {
    if (item.id === "classes") {
      return { openClassModal: true };
    }
    if (item.id === "records") {
      return { openRecordModal: true };
    }
    return null;
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 transform flex-col bg-white shadow-2xl transition-transform duration-300 dark:bg-gray-800 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-200 p-6 dark:border-gray-700">
          <h2 className="bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text py-2 text-xl font-bold text-transparent dark:from-blue-400 dark:to-blue-300">
            Navigation
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        <nav className="flex-1 space-y-2 p-4">
          {navItems.map((item) => {
            const IconComponent = item.icon;
            const isEnabled = roleAllowsItem(item.id);

            if (!isEnabled) {
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled
                  className="w-full cursor-not-allowed rounded-lg bg-gray-50 px-4 py-3 text-gray-400 dark:bg-gray-800/60 dark:text-gray-500"
                  title="Locked for your role"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <IconComponent className={`h-5 w-5 ${item.color} opacity-40`} />
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <Lock className="h-4 w-4" />
                  </div>
                </button>
              );
            }

            return (
              <Link
                key={item.id}
                to={getNavTarget(item)}
                state={getNavState(item)}
                onClick={onClose}
                className="group flex items-center gap-3 rounded-lg px-4 py-3 text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <IconComponent
                  className={`h-5 w-5 ${item.color} transition-transform group-hover:scale-110`}
                />
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-gray-200 p-4 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setShowLogoutModal(true)}
            className="w-full rounded-lg px-4 py-3 text-left text-red-700 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30"
          >
            <span className="flex items-center gap-3">
              <LogOut className="h-5 w-5" />
              <span className="text-sm font-medium">Logout</span>
            </span>
          </button>

          <p className="pt-1 text-center text-xs text-gray-500 dark:text-gray-400">Scoorla v1.0</p>
        </div>
      </aside>

      <LogoutConfirm
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => {
          setShowLogoutModal(false);
          onClose();
        }}
      />
    </>
  );
}
