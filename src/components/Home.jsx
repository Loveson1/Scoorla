// src/pages/Home.jsx
import React from "react";
import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="flex justify-center">
      <div className="  flex flex-col items-center justify-self-start h-screen dark:bg-gray-900 dark:text-white ">
        <h1 className="text-5xl font-bold mt-20 text-center">
          Welcome to Mini Board
        </h1>
        <h2 className="text-3xl font-bold py-4 text-center">Ready to Work?</h2>
        <Link
          to="/Users"
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-center"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
