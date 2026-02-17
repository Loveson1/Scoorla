// src/App.jsx
import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import Home from "./components/Home";
import School from "./components/create-school";
import SchoolDashboard from "./components/school-dashboard";
import ClassDashboard from "./components/class-dashboard";
import RecordDashboard from "./components/RecordDashboard";
import ResultPreview from "./components/ResultPreview";
import StudentResultSheet from "./components/StudentResultSheet";
import AdminConfig from "./components/AdminConfig";
import Signup from "./components/Signup";
import Login from "./components/Login";
import ForgotPassword from "./components/ForgotPassword";
import VerifyEmail from "./components/VerifyEmail";
import Welcome from "./components/Welcome";
import RoleSelector from "./components/RoleSelector";
import AdminPasscodeSetup from "./components/AdminPasscodeSetup";
import ClassTeacherAccess from "./components/ClassTeacherAccess";
import SubjectTeacherAccess from "./components/SubjectTeacherAccess";

function App() {
  const [authStateLoaded, setAuthStateLoaded] = useState(false);

  useEffect(() => {
    // Listen for auth state changes to ensure app knows when user is authenticated
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Auth state has been determined
      setAuthStateLoaded(true);
    });

    return unsubscribe;
  }, []);

  if (!authStateLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-700 dark:text-gray-300">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        {/* ===== Public Authentication Routes (without Layout) ===== */}
        <Route
          path="/welcome"
          element={
            <ProtectedRoute allowUnonboarded={true}>
              <Welcome />
            </ProtectedRoute>
          }
        />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route
          path="/select-role"
          element={
            <ProtectedRoute allowUnonboarded={true}>
              <RoleSelector />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin-passcode-setup"
          element={
            <ProtectedRoute allowUnonboarded={true}>
              <AdminPasscodeSetup />
            </ProtectedRoute>
          }
        />

        <Route
          path="/class-teacher-access"
          element={
            <ProtectedRoute allowUnonboarded={true}>
              <ClassTeacherAccess />
            </ProtectedRoute>
          }
        />

        <Route
          path="/subject-teacher-access"
          element={
            <ProtectedRoute allowUnonboarded={true}>
              <SubjectTeacherAccess />
            </ProtectedRoute>
          }
        />

        {/* ===== Onboarding Route (requires auth, but NOT onboarding complete) ===== */}
        {/* School creation is part of onboarding flow */}
        <Route
          path="/school"
          element={
            <ProtectedRoute allowUnonboarded={true}>
              <School />
            </ProtectedRoute>
          }
        />

        {/* ===== Protected App Routes (requires auth + completed onboarding) ===== */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          {/* Main dashboard - shows school dashboard for onboarded users */}
          <Route
            index
            element={
              <ProtectedRoute>
                <Navigate to="/home" replace />
              </ProtectedRoute>
            }
          />

          <Route
            path="home"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />

          <Route
            path="school-dashboard"
            element={
              <ProtectedRoute>
                <SchoolDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="class-dashboard"
            element={
              <ProtectedRoute>
                <ClassDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="record-dashboard"
            element={
              <ProtectedRoute>
                <RecordDashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="result-preview"
            element={
              <ProtectedRoute>
                <ResultPreview />
              </ProtectedRoute>
            }
          />

          <Route
            path="student-result-sheet"
            element={
              <ProtectedRoute>
                <StudentResultSheet />
              </ProtectedRoute>
            }
          />

          <Route
            path="admin-config"
            element={
              <AdminRoute>
                <AdminConfig />
              </AdminRoute>
            }
          />
        </Route>

        {/* Catch-all - redirect to home */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
