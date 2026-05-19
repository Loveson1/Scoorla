import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveSchoolData } from "./utils/school-data";
import { initializeSchoolAcademicCycle } from "../utils/firestoreService";
import { markOnboardingComplete } from "../utils/onboardingUtils";
import { getCurrentUser } from "../utils/authUtils";
import { firestore } from "../firebase";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { Loader } from "lucide-react";
import { useAuthContext } from "../context/AuthContext";

const waitForOnboardingConfirmation = (uid, timeoutMs = 10000) =>
  new Promise((resolve, reject) => {
    const resolvedUid = String(uid || "").trim();
    if (!resolvedUid) {
      reject(new Error("User UID is required to confirm onboarding."));
      return;
    }

    let unsubscribe = null;
    const timeoutId = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      reject(new Error("Timed out waiting for onboarding confirmation."));
    }, timeoutMs);

    unsubscribe = onSnapshot(
      doc(firestore, "users", resolvedUid),
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!snapshot.exists() || snapshot.metadata.hasPendingWrites) return;
        const data = snapshot.data() || {};
        const profileMatchesAuth = String(data?.uid || "").trim() === resolvedUid;
        const complete = data?.onboarding?.onboardingCompleted === true;
        if (profileMatchesAuth && complete) {
          clearTimeout(timeoutId);
          if (unsubscribe) unsubscribe();
          resolve(data);
        }
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });

export default function School() {



  const navigate = useNavigate();
  const {
    profile,
    isProfileSynced,
    profileHasPendingWrites,
  } = useAuthContext();
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
  const buildSchoolSlug = (value) =>
    normalizeWhitespace(value)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  const buildUidScopedSchoolId = (schoolName, userId) => {
    const slug = buildSchoolSlug(schoolName);
    const uidSuffix = String(userId || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8);
    return slug && uidSuffix ? `${slug}-${uidSuffix}` : slug;
  };
  const isPermissionDeniedError = (error) =>
    String(error?.code || "").toLowerCase().includes("permission-denied");
  const attachStageToError = (error, stage) => {
    if (error && typeof error === "object") {
      error.stage = stage;
    }
    return error;
  };
  const isAcademicCycleReady = (settingsData = {}) => {
    const activeSessionId = String(settingsData?.activeSessionId || "").trim();
    const activeTermId = String(settingsData?.activeTermId || "").trim();
    const activeTermDocId = String(settingsData?.activeTermDocId || "").trim();
    return !!activeSessionId && (!!activeTermId || !!activeTermDocId);
  };
  const readUserProfile = async (userId) => {
    try {
      const userSnap = await getDoc(doc(firestore, "users", userId));
      if (!userSnap.exists()) return null;
      const userData = userSnap.data() || {};
      return String(userData?.uid || "").trim() === String(userId || "").trim()
        ? userData
        : null;
    } catch {
      return null;
    }
  };
  const readSchoolBootstrapState = async (schoolId) => {
    try {
      const [schoolSnap, settingsSnap] = await Promise.all([
        getDoc(doc(firestore, "schools", schoolId)),
        getDoc(doc(firestore, "settings", schoolId)),
      ]);
      return {
        school: schoolSnap.exists() ? schoolSnap.data() || {} : null,
        settings: settingsSnap.exists() ? settingsSnap.data() || {} : null,
      };
    } catch {
      return {
        school: null,
        settings: null,
      };
    }
  };

  // Check if onboarding is already completed, if so redirect
  useEffect(() => {
    if (!isProfileSynced || profileHasPendingWrites) return;
    if (profile?.onboarding?.onboardingCompleted === true) {
      navigate("/school-dashboard", { replace: true });
    }
  }, [isProfileSynced, navigate, profile, profileHasPendingWrites]);

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

      const existingUserProfile = await readUserProfile(currentUser.uid);
      const existingProfileUid = String(existingUserProfile?.uid || "").trim();
      const existingBoundSchoolId = String(existingUserProfile?.schoolId || "").trim();
      const existingRole = String(existingUserProfile?.role || "").trim().toLowerCase();

      const derivedSchoolId = buildUidScopedSchoolId(sanitizedForm.name, currentUser.uid);
      const schoolId = existingBoundSchoolId || derivedSchoolId;
      
      if (!schoolId) {
        setErrors({ submit: "Error: School name must contain valid characters" });
        setIsLoading(false);
        return;
      }

      // School onboarding must always bind the creator as admin for this school.
      const hasBoundAdminProfile =
        existingProfileUid === currentUser.uid &&
        existingBoundSchoolId &&
        existingBoundSchoolId === schoolId &&
        existingRole === "admin";
      if (!hasBoundAdminProfile) {
        try {
          await setDoc(
            doc(firestore, "users", currentUser.uid),
            {
              uid: currentUser.uid,
              email: currentUser.email || "",
              role: "admin",
              schoolId,
              isActive: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (bindingError) {
          const refreshedUserProfile = await readUserProfile(currentUser.uid);
          const existingSchoolId = String(refreshedUserProfile?.schoolId || "").trim();
          const refreshedRole = String(refreshedUserProfile?.role || "").trim().toLowerCase();
          if (!(existingSchoolId === schoolId && refreshedRole === "admin")) {
            throw attachStageToError(bindingError, "bind_school");
          }
        }
      }

      // Save school profile after admin/school binding has been established.
      try {
        await saveSchoolData(sanitizedForm, currentUser.uid, schoolId);
      } catch (schoolSaveError) {
        const existingSchoolState = await readSchoolBootstrapState(schoolId);
        const existingSchoolName = normalizeWhitespace(existingSchoolState?.school?.name);
        if (
          !(
            isPermissionDeniedError(schoolSaveError) &&
            existingSchoolName &&
            existingSchoolName.toLowerCase() === sanitizedForm.name.toLowerCase()
          )
        ) {
          throw attachStageToError(schoolSaveError, "school_profile");
        }
      }

      // Create the first academic session + current term for the school.
      const existingSchoolState = await readSchoolBootstrapState(schoolId);
      if (!isAcademicCycleReady(existingSchoolState?.settings)) {
        try {
          await initializeSchoolAcademicCycle({
            schoolId,
            initialSessionName: sanitizedForm.startingSessionName,
            initialTermAlias: sanitizedForm.startingTermAlias,
          });
        } catch (cycleError) {
          const fallbackSchoolState = await readSchoolBootstrapState(schoolId);
          if (!isAcademicCycleReady(fallbackSchoolState?.settings)) {
            throw attachStageToError(cycleError, "academic_cycle");
          }
        }
      }

      await markOnboardingComplete(currentUser.uid);
      await waitForOnboardingConfirmation(currentUser.uid);

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
        const stage = String(error?.stage || "").trim();
        const stageMessageMap = {
          bind_school:
            "Permission denied while linking your admin account to the new school.",
          school_profile:
            "Permission denied while creating the school profile.",
          academic_cycle:
            "Permission denied while creating the first academic session and term.",
        };
        setErrors({
          submit:
            stageMessageMap[stage] ||
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
