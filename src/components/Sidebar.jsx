import { X, BookOpen, Settings, BarChart3, FolderOpen, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { getCurrentUser, isAdmin } from "../utils/authUtils";

export default function Sidebar({ isOpen, onClose }) {
  const [userIsAdmin, setUserIsAdmin] = useState(false);
  const [selectedRole, setSelectedRole] = useState(() => {
    const user = getCurrentUser();
    if (!user) return null;
    return localStorage.getItem(`selectedRole_${user.uid}`);
  });

  useEffect(() => {
    const checkAdminStatus = async () => {
      const user = getCurrentUser();
      if (user) {
        const roleKey = `selectedRole_${user.uid}`;
        const role = localStorage.getItem(roleKey);
        setSelectedRole(role);
        const adminStatus = await isAdmin(user.uid);
        setUserIsAdmin(adminStatus);
      } else {
        setSelectedRole(null);
      }
    };

    checkAdminStatus();
  }, []);

  useEffect(() => {
    const syncRole = () => {
      const user = getCurrentUser();
      if (!user) return;
      const roleKey = `selectedRole_${user.uid}`;
      setSelectedRole(localStorage.getItem(roleKey));
    };
    window.addEventListener("storage", syncRole);
    return () => window.removeEventListener("storage", syncRole);
  }, []);

  const baseNavItems = [
    { id: "school-dashboard", icon: BookOpen, label: "Dashboard", href: "/school-dashboard", color: "text-green-600 dark:text-green-400" },
    { id: "classes", icon: FolderOpen, label: "Classes", href: "/class-dashboard", color: "text-indigo-600 dark:text-indigo-400" },
    { id: "records", icon: BarChart3, label: "Records", href: "/record-dashboard", color: "text-purple-600 dark:text-purple-400" },
  ];

  const adminNavItem = { id: "admin-settings", icon: Settings, label: "Admin Settings", href: "/admin-config", color: "text-orange-600 dark:text-orange-400" };

  const roleAllowsItem = (role, itemId) => {
    if (role === "class_teacher") return itemId === "classes";
    if (role === "subject_teacher") return itemId === "records";
    return true;
  };

  const canSeeAdminSettings =
    selectedRole === "admin" || userIsAdmin;
  const navItems = canSeeAdminSettings ? [...baseNavItems, adminNavItem] : baseNavItems;

  return (
    <>
      {/* Overlay when sidebar is open (click to close) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 shadow-2xl transform transition-transform duration-300 z-50 flex flex-col
        ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl py-2 font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent dark:from-blue-400 dark:to-blue-300">
            Navigation
          </h2>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => {
            const IconComponent = item.icon;
            const isEnabled = roleAllowsItem(selectedRole, item.id);

            if (!isEnabled) {
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/60 cursor-not-allowed"
                  title="Locked for your role"
                >
                  <div className="flex items-center gap-3">
                    <IconComponent className={`w-5 h-5 ${item.color} opacity-40`} />
                    <span className="font-medium text-sm">{item.label}</span>
                  </div>
                  <Lock className="w-4 h-4" />
                </button>
              );
            }

            return (
              <Link
                key={item.id}
                to={item.href}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
              >
                <IconComponent className={`w-5 h-5 ${item.color} group-hover:scale-110 transition-transform`} />
                <span className="font-medium text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">Scoorla v1.0</p>
        </div>
      </aside>
    </>
  );
}
