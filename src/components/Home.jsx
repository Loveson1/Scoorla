// src/pages/Home.jsx
import React from "react";
import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center h-screen dark:bg-gray-900 dark:text-white ">
      <h1 className="text-5xl font-bold mb-1">Welcome to Mini Board</h1>
        <h2 className="text-3xl font-bold py-4">Ready to Work?</h2>
      <Link
        to="/Users"
        className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-center"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
