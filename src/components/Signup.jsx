import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { Eye, EyeOff, Loader } from "lucide-react";
import { auth, firestore } from "../firebase";
import { sendVerificationEmail } from "../utils/authUtils";
import { doc, setDoc } from "firebase/firestore";

export default function Signup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [form, setForm] = useState({
    schoolName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  // Validation functions
  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password) => {
    return password.length >= 8;
  };

  const validateForm = () => {
    const newErrors = {};

    if (!form.schoolName.trim()) {
      newErrors.schoolName = "School name is required";
    } else if (form.schoolName.trim().length < 3) {
      newErrors.schoolName = "School name must be at least 3 characters";
    }

    if (!form.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!validateEmail(form.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (!form.password) {
      newErrors.password = "Password is required";
    } else if (!validatePassword(form.password)) {
      newErrors.password = "Password must be at least 8 characters";
    }

    if (!form.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    return newErrors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Clear error for this field when user starts typing
    if (error) {
      setError("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate form
    const formErrors = validateForm();
    if (Object.keys(formErrors).length > 0) {
      setError(Object.values(formErrors)[0]);
      return;
    }

    try {
      setLoading(true);
      setError("");

      // Create user in Firebase
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        form.email,
        form.password
      );

      // Create user document in Firestore
      await setDoc(doc(firestore, "users", userCredential.user.uid), {
        uid: userCredential.user.uid,
        email: form.email,
        role: 'admin',  // Set admin role for school creation
        createdAt: new Date().toISOString(),
        // schoolId will be set later during onboarding
      });

      // Send email verification
      await sendVerificationEmail();

      // Store school name in localStorage for onboarding
      localStorage.setItem("newSchoolName", form.schoolName);
      localStorage.setItem("userId", userCredential.user.uid);
      localStorage.setItem("userEmail", userCredential.user.email);

      // Reset form
      setForm({
        schoolName: "",
        email: "",
        password: "",
        confirmPassword: "",
      });

      // Redirect to verify email page
      navigate("/verify-email", { state: { email: userCredential.user.email } });
    } catch (err) {
      setLoading(false);
      if (err.code === "auth/email-already-in-use") {
        setError("This email is already registered. Please use another email or sign in.");
      } else if (err.code === "auth/invalid-email") {
        setError("Invalid email format. Please check and try again.");
      } else if (err.code === "auth/weak-password") {
        setError("Password is too weak. Use at least 8 characters with a mix of letters and numbers.");
      } else {
        setError("Failed to create account. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center py-16 px-4">
      <div className="w-full max-w-[620px]">
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <h1 className="text-2xl md:text-4xl font-bold text-black dark:text-white mb-3">
            Create School Account
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm md:text-base">
            Start managing your school results with Scoorla
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 md:p-8 border border-gray-200 dark:border-gray-700">
          <form onSubmit={handleSubmit}>
           

            {/* School Name Field */}
            <div className="mb-5">
              <label htmlFor="schoolName" className="label-w block mb-2">
                School Name
              </label>
              <input
                type="text"
                id="schoolName"
                name="schoolName"
                value={form.schoolName}
                onChange={handleChange}
                placeholder="Enter your school name"
                className="input w-full focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
              />
            
            </div>

            {/* Email Field */}
            <div className="mb-5">
              <label htmlFor="email" className="label-w block mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="admin@school.com"
                className="input w-full focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Use your school email address
              </p>
            </div>

            {/* Password Field */}
            <div className="mb-5">
              <label htmlFor="password" className="label-w block mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Enter password (min 8 characters)"
                  className="input w-full pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                At least 8 characters, mix of letters and numbers recommended
              </p>
            </div>

            {/* Confirm Password Field */}
            <div className="mb-6">
              <label htmlFor="confirmPassword" className="label-w block mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  id="confirmPassword"
                  name="confirmPassword"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  placeholder="Re-enter your password"
                  className="input w-full pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                  title={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

 {error && (
              <div className="mb-6 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
                <p className="text-red-700 dark:text-red-300 text-sm font-medium">
                  {error}
                </p>
              </div>
            )}
            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="form-btn w-full bg-blue-800 hover:bg-blue-900 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
            >
              {loading && <Loader className="w-5 h-5 animate-spin" />}
              {loading ? "Creating Account..." : "Create Account"}
            </button>
             {/* Error Message */}
           
          </form>

          {/* Divider */}
          <div className="my-6 flex items-center gap-4">
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
            <span className="text-sm text-gray-500 dark:text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
          </div>

          {/* Sign In Link */}
          <p className="text-center text-gray-600 dark:text-gray-300 text-sm">
            Already have an account?{" "}
            <Link
              to="/login"
              className="text-blue-800 dark:text-blue-400 font-semibold hover:underline"
            >
              Sign In
            </Link>
          </p>
        </div>

        {/* Footer Info */}
        <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400">
          <p>
            By creating an account, you agree to our{" "}
            <Link to="#" className="hover:underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="#" className="hover:underline">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
