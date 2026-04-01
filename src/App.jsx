// src/App.jsx
import React, { useState, useEffect, Suspense, lazy } from "react";
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
import NetworkStatusBanner from "./components/NetworkStatusBanner";
import RequireSuperAdmin from "./platform/RequireSuperAdmin";
import FirestoreDebugPanel from "./components/FirestoreDebugPanel";

const Home = lazy(() => import("./components/Home"));
const School = lazy(() => import("./components/create-school"));
const SchoolDashboard = lazy(() => import("./components/school-dashboard"));
const ClassDashboard = lazy(() => import("./components/class-dashboard"));
const RecordDashboard = lazy(() => import("./components/RecordDashboard"));
const ResultPreview = lazy(() => import("./components/ResultPreview"));
const StudentResultSheet = lazy(() => import("./components/StudentResultSheet"));
const AdminConfig = lazy(() => import("./components/AdminConfig"));
const SchoolDisabledNotice = lazy(() => import("./components/SchoolDisabledNotice"));
const Signup = lazy(() => import("./components/Signup"));
const Login = lazy(() => import("./components/Login"));
const ForgotPassword = lazy(() => import("./components/ForgotPassword"));
const VerifyEmail = lazy(() => import("./components/VerifyEmail"));
const Welcome = lazy(() => import("./components/Welcome"));
const TeacherLogin = lazy(() => import("./components/TeacherLogin"));
const AccessDenied = lazy(() => import("./components/AccessDenied"));
const PlatformLayout = lazy(() => import("./platform/PlatformLayout"));
const PlatformDashboard = lazy(() => import("./platform/PlatformDashboard"));
const PlatformSchools = lazy(() => import("./platform/PlatformSchools"));
const PlatformSchoolDetail = lazy(() => import("./platform/PlatformSchoolDetail"));
const PlatformSupport = lazy(() => import("./platform/PlatformSupport"));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-r from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-700 dark:text-gray-300">Loading...</p>
      </div>
    </div>
  );
}

function App() {
  const [authStateLoaded, setAuthStateLoaded] = useState(false);

  useEffect(() => {
    // Listen for auth state changes to ensure app knows when user is authenticated
    const unsubscribe = onAuthStateChanged(auth, () => {
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
      <NetworkStatusBanner />
      <FirestoreDebugPanel />
      <Suspense fallback={<RouteFallback />}>
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
          <Route path="/platform/login" element={<Login />} />
          <Route path="/teacher-login" element={<TeacherLogin />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route
            path="/platform"
            element={
              <RequireSuperAdmin>
                <PlatformLayout />
              </RequireSuperAdmin>
            }
          >
            <Route index element={<PlatformDashboard />} />
            <Route path="schools" element={<PlatformSchools />} />
            <Route path="schools/:schoolId" element={<PlatformSchoolDetail />} />
            <Route path="support" element={<PlatformSupport />} />
          </Route>

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
                <ProtectedRoute
                  allowedRoles={[
                    "admin",
                    "class_teacher",
                    "subject_teacher",
                    "class_subject_teacher",
                  ]}
                >
                  <SchoolDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="class-dashboard"
              element={
                <ProtectedRoute allowedRoles={["admin", "class_teacher", "class_subject_teacher"]}>
                  <ClassDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="record-dashboard"
              element={
                <ProtectedRoute allowedRoles={["admin", "subject_teacher", "class_subject_teacher"]}>
                  <RecordDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="result-preview"
              element={
                <ProtectedRoute allowedRoles={["admin", "subject_teacher", "class_subject_teacher"]}>
                  <ResultPreview />
                </ProtectedRoute>
              }
            />

            <Route
              path="student-result-sheet"
              element={
                <ProtectedRoute
                  allowedRoles={[
                    "admin",
                    "class_teacher",
                    "subject_teacher",
                    "class_subject_teacher",
                  ]}
                >
                  <StudentResultSheet />
                </ProtectedRoute>
              }
            />

            <Route
              path="admin-config"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminConfig />
                </ProtectedRoute>
              }
            />

            <Route
              path="access-denied"
              element={
                <ProtectedRoute>
                  <AccessDenied />
                </ProtectedRoute>
              }
            />

            <Route
              path="school-disabled"
              element={
                <ProtectedRoute allowUnonboarded={true} allowDisabledSchool={true}>
                  <SchoolDisabledNotice />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Catch-all - redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
