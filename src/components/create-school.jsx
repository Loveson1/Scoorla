import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { saveSchoolData } from "./utils/school-data";
import OnboardingSuccess from "./OnboardingSuccess";
import { markOnboardingComplete, isOnboardingComplete } from "../utils/onboardingUtils";
import { getCurrentUser, setUserRole, getSelectedRole, clearSelectedRole } from "../utils/authUtils";
import { generateAdminPasscode, hashAdminPasscode, storeAdminPasscodeHash } from "../utils/adminPasscodeUtils";
import { firestore } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { Loader } from "lucide-react";

export default function School() {
  const navigate = useNavigate();
  const [logoPreview, setLogopreview] = useState(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    logo: "",
    name: "",
    address: "",
    email: "",
    phone: "",
    motto: "",
  });

  const schoolLogoRef = useRef(null);

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

    if (!form.name.trim()) {
      newErrors.name = "School name is required";
    } else if (form.name.trim().length < 3) {
      newErrors.name = "School name must be at least 3 characters";
    } else if (form.name.trim().length > 100) {
      newErrors.name = "School name must not exceed 100 characters";
    }

    if (!form.address.trim()) {
      newErrors.address = "School address is required";
    } else if (form.address.trim().length < 5) {
      newErrors.address = "Address must be at least 5 characters";
    } else if (form.address.trim().length > 200) {
      newErrors.address = "Address must not exceed 200 characters";
    }

    if (!form.email.trim()) {
      newErrors.email = "Email address is required";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(form.email)) {
        newErrors.email = "Please enter a valid email address";
      }
    }

    if (!form.phone.trim()) {
      newErrors.phone = "School phone number is required";
    } else if (form.phone.trim().length < 10) {
      newErrors.phone = "Phone number must be at least 10 digits";
    } else if (!/^[\d\s\-\+\(\)]+$/.test(form.phone)) {
      newErrors.phone = "Please enter a valid phone number";
    }

    if (!form.motto.trim()) {
      newErrors.motto = "School motto is required";
    } else if (form.motto.trim().length < 3) {
      newErrors.motto = "Motto must be at least 3 characters";
    } else if (form.motto.trim().length > 150) {
      newErrors.motto = "Motto must not exceed 150 characters";
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
      // Get current user
      const currentUser = getCurrentUser();
      if (!currentUser) {
        setErrors({ submit: "Error: User not authenticated. Please log in again." });
        setIsLoading(false);
        return;
      }

      // Generate slug-format schoolId from school name (lowercase, no spaces, dashes)
      const schoolId = form.name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      
      if (!schoolId) {
        setErrors({ submit: "Error: School name must contain valid characters" });
        setIsLoading(false);
        return;
      }

      // IMPORTANT: Set schoolId in user document FIRST (required by Firebase Rules)
      // This must happen before saveSchoolData, or Rules will deny permission
      const selectedRole = getSelectedRole(currentUser.uid);
      await setUserRole(currentUser.uid, selectedRole || 'admin', schoolId);

      // NOW save school data to Firebase Realtime Database
      // User now has role='admin' and schoolId set, so Rules will allow the write
      await saveSchoolData(form, currentUser.uid, schoolId);
      
      // Clear selected role from localStorage if it was stored
      if (selectedRole) {
        clearSelectedRole(currentUser.uid);
      }

      // Generate admin passcode
      const adminPasscode = generateAdminPasscode();
      const hashedPasscode = await hashAdminPasscode(adminPasscode);

      // Store hashed passcode in Firestore at schools/{schoolId}/security/adminPasscode
      await storeAdminPasscodeHash(schoolId, hashedPasscode);

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
      });
      setLogopreview(null);
      setErrors({});
      if (schoolLogoRef.current) {
        schoolLogoRef.current.value = "";
      }

      // Navigate to admin passcode setup page with passcode to display
      navigate("/admin-passcode-setup", {
        replace: true,
        state: { passcode: adminPasscode, schoolName: form.name },
      });
    } catch (error) {
      console.error("Error saving school:", error);
      setErrors({ submit: "Error saving school. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <>
      {/* Success Modal */}
      {showSuccessModal && <OnboardingSuccess />}

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
    </>
  );
}
