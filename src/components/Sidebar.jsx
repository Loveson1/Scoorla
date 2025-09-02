import { X } from "lucide-react";
import { Link } from "react-router-dom";

export default function Sidebar({ isOpen, onClose }) {
  return (
    <>
      {/* Overlay when sidebar is open (click to close) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-40 z-40"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 w-60 bg-gray-200 dark:bg-gray-800 p-4 shadow-lg transform transition-transform duration-300 z-50
        ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            Menu
          </h2>
          <button onClick={onClose}>
            <X className="w-6 h-6 text-gray-700 dark:text-gray-200" />
          </button>
        </div>

        <nav className="space-y-4">
          <Link
            to="/home"
            onClick={onClose}
            className="block hover:underline dark:text-white"
          >
            Home
          </Link>
          <Link
            to="/Users"
            onClick={onClose}
            className="block hover:underline dark:text-white"
          >
            Dashboard
          </Link>
        </nav>
      </aside>
    </>
  );
}
