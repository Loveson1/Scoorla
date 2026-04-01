import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { saveSchoolData } from "./utils/school-data";
import { initializeSchoolAcademicCycle } from "../utils/firestoreService";
import { markOnboardingComplete, isOnboardingComplete } from "../utils/onboardingUtils";
import { getCurrentUser, setUserRole } from "../utils/authUtils";
import { firestore } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { Loader } from "lucide-react";

export default function School() {
  const navigate = useNavigate();
  const [logoPreview, setLogopreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    logo: "",
    name: "",
    address: "",
    email: "",
    phone: "",
    motto: "",
    startingSessionName: "",
    startingTermAlias: "term1",
  });

  const schoolLogoRef = useRef(null);
  const normalizeWhitespace = (value) => String(value || "").replace(/\s+/g, " ").trim();

  // Check if onboarding is already completed, if so redirect
  useEffect(() => {
    const checkOnboarding = async () => {
      const isComplete = await isOnboardingComplete();
      if (isComplete) {
        // Check if user has a schoolId (proves they actually completed onboarding)
        const user = getCurrentUser();
        if (user) {
          const userDocRef = firestore && doc(firestore, "users", user.uid);
          if (userDocRef) {
            try {
              const userSnap = await getDoc(userDocRef);
              if (userSnap.exists() && userSnap.data().schoolId) {
                // They have completed onboarding with a school, redirect to dashboard
                navigate("/school-dashboard", { replace: true });
              }
              // If no schoolId, allow them to continue creating school
            } catch (err) {
              console.error("Error checking user data:", err);
            }
          }
        }
      }
    };
    
    checkOnboarding();
  }, [navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    // Clear error for this field when user starts typing
    if (errors[name]) {
      setErrors({ ...errors, [name]: "" });
    }
  };

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setErrors({ ...errors, logo: "Please upload a valid image file" });
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setErrors({ ...errors, logo: "Image size must be less than 2MB" });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      form.logo = reader.result;
    };

    reader.readAsDataURL(file);
    setLogopreview(URL.createObjectURL(file));
    setErrors({ ...errors, logo: "" });
  };

  // Validation functions
  const validateForm = () => {
    const newErrors = {};
    const trimmedName = normalizeWhitespace(form.name);
    const trimmedAddress = normalizeWhitespace(form.address);
    const trimmedEmail = normalizeWhitespace(form.email).toLowerCase();
    const trimmedPhone = normalizeWhitespace(form.phone);
    const trimmedMotto = normalizeWhitespace(form.motto);
    const trimmedSessionName = normalizeWhitespace(form.startingSessionName);
    const normalizedStartingTerm = String(form.startingTermAlias || "").trim();
    const validTextRegex = /^[a-zA-Z0-9\s.,&'()\-/:]+$/;

    if (!trimmedName) {
      newErrors.name = "School name is required";
    } else if (trimmedName.length < 3) {
      newErrors.name = "School name must be at least 3 characters";
    } else if (trimmedName.length > 100) {
      newErrors.name = "School name must not exceed 100 characters";
    } else if (!validTextRegex.test(trimmedName)) {
      newErrors.name = "School name contains invalid characters";
    }

    if (!trimmedAddress) {
      newErrors.address = "School address is required";
    } else if (trimmedAddress.length < 5) {
      newErrors.address = "Address must be at least 5 characters";
    } else if (trimmedAddress.length > 200) {
      newErrors.address = "Address must not exceed 200 characters";
    } else if (!validTextRegex.test(trimmedAddress)) {
      newErrors.address = "Address contains invalid characters";
    }

    if (!trimmedEmail) {
      newErrors.email = "Email address is required";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(trimmedEmail)) {
        newErrors.email = "Please enter a valid email address";
      }
    }

    if (!trimmedPhone) {
      newErrors.phone = "School phone number is required";
    } else if (!/^[\d\s+()-]+$/.test(trimmedPhone)) {
      newErrors.phone = "Please enter a valid phone number";
    } else {
      const digits = trimmedPhone.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) {
        newErrors.phone = "Phone number must contain 10 to 15 digits";
      }
    }

    if (!trimmedMotto) {
      newErrors.motto = "School motto is required";
    } else if (trimmedMotto.length < 3) {
      newErrors.motto = "Motto must be at least 3 characters";
    } else if (trimmedMotto.length > 150) {
      newErrors.motto = "Motto must not exceed 150 characters";
    } else if (!validTextRegex.test(trimmedMotto)) {
      newErrors.motto = "Motto contains invalid characters";
    }

    if (!trimmedSessionName) {
      newErrors.startingSessionName = "Academic session is required";
    } else {
      const match = trimmedSessionName.match(/^(\d{4})\s*\/\s*(\d{4})$/);
      if (!match) {
        newErrors.startingSessionName = "Use session format YYYY/YYYY";
      } else {
        const startYear = Number(match[1]);
        const endYear = Number(match[2]);
        if (endYear !== startYear + 1) {
          newErrors.startingSessionName = "Session years must be consecutive";
        } else if (startYear < 2025) {
          newErrors.startingSessionName = "Session must be 2025/2026 or later";
        }
      }
    }

    if (!["term1", "term2", "term3"].includes(normalizedStartingTerm)) {
      newErrors.startingTermAlias = "Select a valid starting term";
    }

    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate form
    const newErrors = validateForm();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);

    try {
      const sanitizedForm = {
        ...form,
        name: normalizeWhitespace(form.name),
        address: normalizeWhitespace(form.address),
        email: normalizeWhitespace(form.email).toLowerCase(),
        phone: normalizeWhitespace(form.phone),
        motto: normalizeWhitespace(form.motto),
        startingSessionName: normalizeWhitespace(form.startingSessionName),
        startingTermAlias: String(form.startingTermAlias || "term1").trim() || "term1",
      };

      // Get current user
      const currentUser = getCurrentUser();
      if (!currentUser) {
        setErrors({ submit: "Error: User not authenticated. Please log in again." });
        setIsLoading(false);
        return;
      }

      // Generate slug-format schoolId from school name (lowercase, no spaces, dashes)
      const schoolId = sanitizedForm.name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      
      if (!schoolId) {
        setErrors({ submit: "Error: School name must contain valid characters" });
        setIsLoading(false);
        return;
      }

      // School onboarding must always bind the creator as admin for this school.
      await setUserRole(currentUser.uid, "admin", schoolId);

      // Save school profile after admin/school binding has been established.
      await saveSchoolData(sanitizedForm, currentUser.uid, schoolId);

      // Create the first academic session + current term for the school.
      await initializeSchoolAcademicCycle({
        schoolId,
        initialSessionName: sanitizedForm.startingSessionName,
        initialTermAlias: sanitizedForm.startingTermAlias,
      });

      // Mark onboarding complete
      await markOnboardingComplete(currentUser.uid);

      // Reset form
      setForm({
        logo: "",
        name: "",
        address: "",
        email: "",
        phone: "",
        motto: "",
        startingSessionName: "",
        startingTermAlias: "term1",
      });
      setLogopreview(null);
      setErrors({});
      if (schoolLogoRef.current) {
        schoolLogoRef.current.value = "";
      }

      // Continue to dashboard after onboarding.
      navigate("/school-dashboard", { replace: true });
    } catch (error) {
      console.error("Error saving school:", error);
      const code = String(error?.code || "");
      if (code.includes("permission-denied")) {
        setErrors({
          submit:
            "Permission denied while saving school. Verify Firestore rules allow first-time admin school binding.",
        });
      } else {
        setErrors({ submit: "Error saving school. Please try again." });
      }
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <div>
      <div className="max-sm:pt-10 ">
        {/* headline and subhead */}
        <div className="z-[1px] relative flex justify-center ">
          <div className="absolute   sm:py-10 pt-5 max-sm:px-[28px] ">
            <div className="text-center  ">
              <h4 className="sm:text-[27px] max-w-[550px] mx-auto text-black dark:text-white mb-[10px]">
                Create School
              </h4>
              <p className="text-[13px] sm:text-[18px] mb-[10px]  sm:mb-[30px] max-w-[650px] ">
                Be the first to experience effortless result management &
                flexible student management dashboard for, teachers and school
                admins.
              </p>
            </div>
            {/*  form */}

            <div className=" max-w-[620px] mx-auto  ">
              <form onSubmit={handleSubmit}>
                {/* Error Messages */}
               

                <div className=" flex  justify-center mx-auto  my-5">
                  <div>
                    <label
                      htmlFor="logo"
                      className="w-28 h-28 rounded-full border border-gray-300 flex items-center justify-center cursor-pointer  hover:border-gray-300 hover:border-2"
                    >
                      {logoPreview ? (
                        <img
                          src={logoPreview}
                          alt="School Logo"
                          className="w-full h-full object-cover rounded-full"
                        />
                      ) : (
                        <span className="text-sm text-gray-500">
                          Upload Logo
                        </span>
                      )}
                    </label>
                    <input
                      type="file"
                      ref={schoolLogoRef}
                      id="logo"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoChange}
                    />
                    <p className="label-w text-center mt-2">School Logo</p>
                    {errors.logo && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.logo}</p>
                    )}
                  </div>
                </div>
                <div className="grid-cols-1 max-sm:grid-cols-1 grid gap-x-[20px] gap-y-[8px] sm:gap-y-[16px] mb-[24px]  sm:mb-[38px]">
                  <div className="flex flex-col">
                    <label htmlFor="name" className="label-w">
                      School Name
                    </label>
                    <input
                      className={`input ${errors.name ? "border-red-500 dark:border-red-400" : ""}`}
                      type="text"
                      id="name"
                      name="name"
                      placeholder="Input School Name"
                      value={form.name}
                      onChange={handleChange}
                    />
                    {errors.name && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.name}</p>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <label htmlFor="address" className="label-w">
                      School Address
                    </label>
                    <input
                      className={`input ${errors.address ? "border-red-500 dark:border-red-400" : ""}`}
                      type="text"
                      id="address"
                      name="address"
                      placeholder="Input Address"
                      value={form.address}
                      onChange={handleChange}
                    />
                    {errors.address && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.address}</p>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <label htmlFor="email" className="label-w">
                      Email Address
                    </label>
                    <input
                      className={`input ${errors.email ? "border-red-500 dark:border-red-400" : ""}`}
                      type="email"
                      id="email"
                      name="email"
                      placeholder="admin@school.com"
                      value={form.email}
                      onChange={handleChange}
                    />
                    {errors.email && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.email}</p>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <label htmlFor="phone" className="label-w">
                      School Number
                    </label>
                    <input
                      className={`input ${errors.phone ? "border-red-500 dark:border-red-400" : ""}`}
                      type="tel"
                      id="phone"
                      name="phone"
                      placeholder="+234 000 000 0000"
                      value={form.phone}
                      onChange={handleChange}
                    />
                    {errors.phone && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.phone}</p>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <label htmlFor="motto" className="label-w">
                      School Motto
                    </label>
                    <input
                      className={`input ${errors.motto ? "border-red-500 dark:border-red-400" : ""}`}
                      type="text"
                      id="motto"
                      name="motto"
                      placeholder="Input Motto"
                      value={form.motto}
                      onChange={handleChange}
                    />
                    {errors.motto && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.motto}</p>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <label htmlFor="startingSessionName" className="label-w">
                      Academic Session
                    </label>
                    <input
                      className={`input ${errors.startingSessionName ? "border-red-500 dark:border-red-400" : ""}`}
                      type="text"
                      id="startingSessionName"
                      name="startingSessionName"
                      placeholder="2025/2026"
                      value={form.startingSessionName}
                      onChange={handleChange}
                    />
                    {errors.startingSessionName && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.startingSessionName}</p>
                    )}
                  </div>

                  <div className="flex flex-col">
                    <label htmlFor="startingTermAlias" className="label-w">
                      Starting Term
                    </label>
                    <select
                      className={`input ${errors.startingTermAlias ? "border-red-500 dark:border-red-400" : ""}`}
                      id="startingTermAlias"
                      name="startingTermAlias"
                      value={form.startingTermAlias}
                      onChange={handleChange}
                    >
                      <option value="term1">First Term</option>
                      <option value="term2">Second Term</option>
                      <option value="term3">Third Term</option>
                    </select>
                    {errors.startingTermAlias && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.startingTermAlias}</p>
                    )}
                  </div>
                </div>

                 {errors.submit && (
                  <div className="mb-6 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
                    <p className="text-red-700 dark:text-red-300 text-sm font-medium">
                      {errors.submit}
                    </p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn form-btn w-full shadow-shadowblack disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading && <Loader className="w-4 h-4 animate-spin" />}
                  {isLoading ? "Saving..." : "Save & Continue"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
