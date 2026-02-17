import { setSchoolProfile, getSchoolProfile, addStudent, getStudentsByClass, setScore, getScoresBySubject, setSchoolSettings, getSchoolSettings, deleteStudent } from "../../utils/firebaseDatabase";
import { setSessionState, getSessionState, setUserData, getUserData } from "../../utils/userSession";
import { auth } from "../../firebase";

// Utility function for rounding: 0.5 and above rounds up, below 0.5 rounds down
export function roundScore(value) {
  return Math.round(value);
}

/**
 * Save school data (now uses Firebase Realtime Database)
 * @param {Object} form - School form data
 * @param {string} userId - Firebase user ID (required)
 * @param {string} schoolId - School ID (required)
 */
export async function saveSchoolData(form, userId, schoolId) {
  try {
    if (!schoolId) {
      console.error("Error: schoolId is required to save school data");
      return;
    }
    
    // Save to Firebase Realtime Database
    const schoolData = {
      name: form.name,
      logo: form.logo || '',
      address: form.address || '',
      email: form.email || '',
      phone: form.phone || '',
      motto: form.motto || '',
    };
    
    await setSchoolProfile(schoolId, schoolData);
    
    // Also keep in sessionStorage for quick access
    setSessionState(`schoolData_${schoolId}`, JSON.stringify(schoolData));
  } catch (error) {
    console.error("Error saving school data:", error);
    throw error;
  }
}

/**
 * Get school data for current user (from Firebase or cache)
 * @param {string} schoolId - School ID
 * @returns {Promise<Object>} School data or empty object
 */
export async function getSchoolData(schoolId) {
  try {
    if (!schoolId) {
      console.warn("Warning: schoolId not provided to getSchoolData");
      return {};
    }

    // Try sessionStorage cache first
    const cached = getSessionState(`schoolData_${schoolId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Fetch school profile, classes, and subjects in parallel
    const [profile, classes, subjects] = await Promise.all([
      getSchoolProfile(schoolId),
      (await import("../../utils/firebaseDatabase")).getClasses(schoolId),
      (await import("../../utils/firebaseDatabase")).getSubjects(schoolId),
    ]);

    let resolvedClasses = classes || {};
    if (!resolvedClasses || Object.keys(resolvedClasses).length === 0) {
      const customClasses = getCustomClasses(schoolId) || [];
      resolvedClasses = customClasses.reduce((acc, cls) => {
        const classId = typeof cls === "string" ? cls : cls?.id;
        const classLabel =
          typeof cls === "string" ? cls.toUpperCase() : cls?.label || classId;
        if (classId) {
          acc[classId] = { classId, label: classLabel };
        }
        return acc;
      }, {});
    }

    let resolvedSubjects = subjects || {};
    if (!resolvedSubjects || Object.keys(resolvedSubjects).length === 0) {
      resolvedSubjects = getCustomSubjects(schoolId);
    }

    const data = {
      ...(profile || {}),
      classes: resolvedClasses,
      subjects: resolvedSubjects,
    };

    setSessionState(`schoolData_${schoolId}`, JSON.stringify(data));
    return data;
  } catch (error) {
    console.error("Error getting school data:", error);
    return {};
  }
}

/**
 * Clear all school data for a specific school
 * @param {string} schoolId - School ID
 */
export function clearUserSchoolData(schoolId) {
  try {
    if (!schoolId) return;
    // Clear sessionStorage cache
    const keys = Object.keys(sessionStorage);
    keys.forEach(key => {
      if (key.includes(`_${schoolId}`)) {
        sessionStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error("Error clearing user data:", error);
  }
}

/**
 * Save class selection (using sessionStorage)
 * @param {Object} classData - Class selection data
 * @param {string} userId - Firebase user ID
 */
export function saveClassSelection(classData, userId) {
  try {
    if (!userId) return;
    setSessionState(`classSelection_${userId}`, JSON.stringify(classData));
  } catch (error) {
    console.error("Error saving class selection:", error);
  }
}

/**
 * Get class selection (from sessionStorage)
 * @param {string} userId - Firebase user ID
 */
export function getClassSelection(userId) {
  try {
    if (!userId) {
      // Fallback for preview mode: use sessionStorage 'classSelection'
      const data = sessionStorage.getItem("classSelection");
      return data ? JSON.parse(data) : { class: "", term: "", session: "" };
    }
    const data = getSessionState(`classSelection_${userId}`);
    return data ? JSON.parse(data) : { class: "", term: "", session: "" };
  } catch (error) {
    console.error("Error getting class selection:", error);
    return { class: "", term: "", session: "" };
  }
}

/**
 * Save class students (now uses Firebase Realtime Database)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {Array} students - Students array
 * @param {string} userId - Firebase user ID
 */
export async function saveClassStudents(schoolId, classId, students, userId) {
  try {
    if (!schoolId || !classId) return;
    
    // Only add NEW students (with Date.now() IDs) to Firebase
    // Skip students that already have Firebase keys (string IDs)
    const newStudents = [];
    for (const student of students) {
      // Firebase keys are strings, Date.now() IDs are numbers
      // If ID is a number, it's new and needs to be added to Firebase
      if (student.name && typeof student.id === 'number') {
        console.log("Adding NEW student to Firebase:", student);
        const firebaseId = await addStudent(schoolId, {
          name: student.name,
          classId: classId,
          regNo: student.regNumber || '', // Map regNumber to regNo for Firebase
          gender: student.gender || '',
          phone: student.phone || '',
        });
        // Track the mapping of old ID to Firebase ID
        newStudents.push({
          ...student,
          id: firebaseId, // Replace Date.now() ID with Firebase ID
        });
      } else {
        // Already in Firebase, keep as is
        newStudents.push(student);
      }
    }
    
    console.log("Updated students with Firebase IDs:", newStudents);
    
    // Cache updated students with Firebase IDs in sessionStorage
    setSessionState(`students_${schoolId}_${classId}`, JSON.stringify(newStudents));
  } catch (error) {
    console.error("Error saving students:", error);
    throw error;
  }
}

/**
 * Get class students (from Firebase)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 */
export async function getClassStudents(schoolId, classId) {
  try {
    if (!schoolId || !classId) return [];
    
    // Always fetch from Firebase to ensure correct IDs
    const students = await getStudentsByClass(schoolId, classId);
    if (students) {
      // Use the Firebase key as the id for each student
      const studentArray = Object.entries(students).map(([firebaseKey, s]) => ({
        id: firebaseKey,
        name: s.name,
        classId: s.classId,
        regNo: s.regNo || '',
      }));
      setSessionState(`students_${schoolId}_${classId}`, JSON.stringify(studentArray));
      return studentArray;
    }
    
    return [];
  } catch (error) {
    console.error("Error getting students:", error);
    return [];
  }
}

export const JUNIOR_SUBJECTS = [
  "Business Studies",
  "Civic Education",
  "Social Studies",
  "Christian Religious Knowledge/Islamic Studies",
  "English Language",
  "Mathematics",
  "Basic Science and Technology",
  "Agricultural Science",
  "Home Economics",
  "Cultural and Creative Arts",
];

export const SENIOR_SUBJECTS = [
  "English Language",
  "Mathematics",
  "Biology",
  "Further Mathematics",
  "Economics",
  "Literature",
  "Computer Studies",
  "C.R. Studies",
  "Government/History",
  "Geography",
  "French",
  "Fine Arts",
  "Music",
  "Agricultural Science",
  "Commerce",
  "Physics",
  "Chemistry",
  "Financial Accounting",
];

export function getDefaultGradingScale() {
  return {
    A: { min: 70, max: 100 },
    B: { min: 55, max: 69 },
    C: { min: 50, max: 54 },
    D: { min: 45, max: 49 },
    E: { min: 40, max: 44 },
    F: { min: 0, max: 39 },
  };
}

export function calculateGrade(score, gradingScale = getDefaultGradingScale()) {
  for (const [grade, range] of Object.entries(gradingScale)) {
    if (score >= range.min && score <= range.max) {
      return grade;
    }
  }
  return "F";
}

/**
 * Save scores (now uses Firebase Realtime Database)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} subject - Subject name
 * @param {Object} scores - Scores object
 */
export async function saveScores(schoolId, classId, subject, scores) {
  try {
    if (!schoolId || !classId || !subject) return;
    
    // Save each score to Firebase
    for (const [studentId, scoreData] of Object.entries(scores)) {
      if (!studentId || studentId === "undefined") continue;
      await setScore(schoolId, classId, subject, studentId, {
        test1: scoreData.test1 || 0,
        test2: scoreData.test2 || 0,
        exam: scoreData.exam || 0,
      });
    }
    
    // Cache in sessionStorage
    setSessionState(`scores_${schoolId}_${classId}_${subject}`, JSON.stringify(scores));
  } catch (error) {
    console.error("Error saving scores:", error);
    throw error;
  }
}

/**
 * Get scores (from Firebase)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} subject - Subject name
 */
export async function getScores(schoolId, classId, subject) {
  try {
    if (!schoolId || !classId || !subject) return {};
    
    // Always fetch from Firebase, bypass cache
    const scores = await getScoresBySubject(schoolId, classId, subject);
    if (scores) {
      setSessionState(`scores_${schoolId}_${classId}_${subject}`, JSON.stringify(scores));
      return scores;
    }

    return {};
  } catch (error) {
    console.error("Error getting scores:", error);
    return {};
  }
}

export function saveResultSelection(resultData) {
  try {
    localStorage.setItem("resultSelection", JSON.stringify(resultData));
  } catch (error) {
    console.error("Error saving result selection:", error);
  }
}

export function getResultSelection() {
  try {
    const data = localStorage.getItem("resultSelection");
    return data
      ? JSON.parse(data)
      : { class: "", term: "", session: "", subject: "" };
  } catch (error) {
    console.error("Error getting result selection:", error);
    return { class: "", term: "", session: "", subject: "" };
  }
}
export function getRemarkByGrade(grade) {
  const remarks = {
    A: "Excellent",
    B: "Very Good",
    C: "Good",
    D: "Pass",
    E: "Fair",
    F: "Poor",
  };
  return remarks[grade] || "Fair";
}

/**
 * Save admin settings (to Firebase)
 * @param {Object} settings - Settings object
 * @param {string} schoolId - School ID
 */
export async function saveAdminSettings(settings, schoolId) {
  try {
    if (!schoolId) {
      console.error("schoolId required to save admin settings");
      return;
    }
    
    await setSchoolSettings(schoolId, settings);
    setSessionState(`adminSettings_${schoolId}`, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving admin settings:", error);
    throw error;
  }
}

/**
 * Get admin settings (from Firebase)
 * @param {string} schoolId - School ID
 */
export async function getAdminSettings(schoolId) {
  try {
    if (!schoolId) {
      return {
        nextTermBegins: "2026-04-20",
        gradingScale: getDefaultGradingScale(),
      };
    }
    
    // Try cache first
    const cached = getSessionState(`adminSettings_${schoolId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Fetch from Firebase
    const settings = await getSchoolSettings(schoolId);
    if (settings) {
      setSessionState(`adminSettings_${schoolId}`, JSON.stringify(settings));
      return settings;
    }
    
    // Return defaults if not found
    return {
      nextTermBegins: "2026-04-20",
      gradingScale: getDefaultGradingScale(),
    };
  } catch (error) {
    console.error("Error getting admin settings:", error);
    return {
      nextTermBegins: "2026-04-20",
      gradingScale: getDefaultGradingScale(),
    };
  }
}

/**
 * Save student subject scores (to Firebase)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} studentId - Student ID
 * @param {Object} subjectScores - Subject scores object
 */
export async function saveStudentSubjectScores(schoolId, classId, studentId, subjectScores) {
  try {
    if (!schoolId || !classId || !studentId) return;
    
    // Save each score to Firebase
    for (const [subject, scoreData] of Object.entries(subjectScores)) {
      await setScore(schoolId, classId, subject, studentId, scoreData);
    }
    
    setSessionState(`student_scores_${schoolId}_${classId}_${studentId}`, JSON.stringify(subjectScores));
  } catch (error) {
    console.error("Error saving student subject scores:", error);
    throw error;
  }
}

/**
 * Get student subject scores (from Firebase)
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} studentId - Student ID
 */
export async function getStudentSubjectScores(schoolId, classId, studentId) {
  try {
    if (!schoolId || !classId || !studentId) return {};
    
    // Try cache first
    const cached = getSessionState(`student_scores_${schoolId}_${classId}_${studentId}`);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // For now, return empty (would need to fetch all scores for student)
    return {};
  } catch (error) {
    console.error("Error getting student subject scores:", error);
    return {};
  }
}

// Session Management
export function saveSession(session) {
  try {
    localStorage.setItem("currentSession", session);
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

export function getSession() {
  try {
    return localStorage.getItem("currentSession") || "2025/2026";
  } catch (error) {
    console.error("Error getting session:", error);
    return "2025/2026";
  }
}

// Term Management (Admin Preselection)
/**
 * Save current term (admin preselection)
 * @param {string} schoolId - School ID
 * @param {string} term - Term value (e.g., "term1", "term2", "term3")
 */
export function saveTerm(schoolId, term) {
  try {
    setSessionState(`currentTerm_${schoolId}`, term);
  } catch (error) {
    console.error("Error saving term:", error);
  }
}

/**
 * Get current term (preselected by admin)
 * @param {string} schoolId - School ID
 * @returns {string} Current term value
 */
export function getCurrentTerm(schoolId) {
  try {
    return getSessionState(`currentTerm_${schoolId}`) || "term1";
  } catch (error) {
    console.error("Error getting term:", error);
    return "term1";
  }
}

/**
 * Convert term ID to display name
 * @param {string} termId - Term ID ("term1", "term2", "term3", "1st", "2nd", "3rd")
 * @returns {string} Display name (e.g., "First Term")
 */
export function getTermDisplayName(termId) {
  const termMap = {
    "term1": "First Term",
    "term2": "Second Term",
    "term3": "Third Term",
    "1st": "First Term",
    "2nd": "Second Term",
    "3rd": "Third Term",
  };
  return termMap[termId] || termId;
}

/**
 * Get array of terms with IDs and display names
 * @returns {Array} Array of term objects
 */
export function getTerms() {
  return [
    { id: "term1", label: "First Term" },
    { id: "term2", label: "Second Term" },
    { id: "term3", label: "Third Term" },
  ];
}

// Convert class name to ID (e.g., "JSS 1" -> "jss1")
export function generateClassId(className) {
  return className
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

// Custom Classes Management
export function getCustomClasses(schoolId) {
  try {
    const cached = getSessionState(`customClasses_${schoolId}`);
    if (cached) return JSON.parse(cached);
    // Return default classes if none exist
    return [
      { id: "jss1", label: "JSS 1" },
      { id: "jss2", label: "JSS 2" },
      { id: "jss3", label: "JSS 3" },
      { id: "sss1", label: "SSS 1" },
      { id: "sss2", label: "SSS 2" },
      { id: "sss3", label: "SSS 3" },
    ];
  } catch (error) {
    console.error("Error getting custom classes:", error);
    return [];
  }
}

export function saveCustomClasses(schoolId, classes) {
  try {
    setSessionState(`customClasses_${schoolId}`, JSON.stringify(classes));
  } catch (error) {
    console.error("Error saving custom classes:", error);
  }
}

export function addClass(schoolId, classId, classLabel) {
  const classes = getCustomClasses(schoolId);
  if (!classes.find((c) => c.id === classId)) {
    classes.push({ id: classId, label: classLabel });
    saveCustomClasses(schoolId, classes);
  }
}

export function removeClass(schoolId, classId) {
  const classes = getCustomClasses(schoolId).filter((c) => c.id !== classId);
  saveCustomClasses(schoolId, classes);
}

// Custom Subjects Management
export function getCustomSubjects(schoolId) {
  try {
    const cached = getSessionState(`customSubjects_${schoolId}`);
    if (cached) return JSON.parse(cached);
    // Return default subjects if none exist
    return {
      junior: JUNIOR_SUBJECTS,
      senior: SENIOR_SUBJECTS,
    };
  } catch (error) {
    console.error("Error getting custom subjects:", error);
    return { junior: JUNIOR_SUBJECTS, senior: SENIOR_SUBJECTS };
  }
}

export function saveCustomSubjects(schoolId, subjects) {
  try {
    setSessionState(`customSubjects_${schoolId}`, JSON.stringify(subjects));
  } catch (error) {
    console.error("Error saving custom subjects:", error);
  }
}

export function addSubject(schoolId, level, subject) {
  const subjects = getCustomSubjects(schoolId);
  const levelKey = level === "junior" ? "junior" : "senior";
  if (!subjects[levelKey].includes(subject)) {
    subjects[levelKey].push(subject);
    saveCustomSubjects(schoolId, subjects);
  }
}

export function removeSubject(schoolId, level, subject) {
  const subjects = getCustomSubjects(schoolId);
  const levelKey = level === "junior" ? "junior" : "senior";
  subjects[levelKey] = subjects[levelKey].filter((s) => s !== subject);
  saveCustomSubjects(schoolId, subjects);
}

// Updated getSubjectsByClass to use custom subjects
export function getSubjectsByClass(schoolId, className) {
  const customSubjects = getCustomSubjects(schoolId);
  const juniorClasses = ["jss1", "jss2", "jss3"];
  return juniorClasses.includes(className)
    ? customSubjects.junior
    : customSubjects.senior;
}

// Custom Grading Scale Management
export function saveGradingScale(schoolId, gradingScale) {
  try {
    const settings = getSessionState(`adminSettings_${schoolId}`) ? JSON.parse(getSessionState(`adminSettings_${schoolId}`)) : getDefaultGradingScale();
    settings.gradingScale = gradingScale;
    setSessionState(`adminSettings_${schoolId}`, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving grading scale:", error);
  }
}

export function getGradingScale(schoolId) {
  try {
    const settings = getSessionState(`adminSettings_${schoolId}`) ? JSON.parse(getSessionState(`adminSettings_${schoolId}`)) : {};
    return settings.gradingScale || getDefaultGradingScale();
  } catch (error) {
    console.error("Error getting grading scale:", error);
    return getDefaultGradingScale();
  }
}

/**
 * Get last term cumulative for a student
 * - First Term: No last term (returns null)
 * - Second Term: Total score from First Term (test1 + test2 + exam)
 * - Third Term: Average of (First Term Total + Second Term Total) / 2
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} subject - Subject name
 * @param {string} currentTerm - Current term ("term1", "term2", "term3")
 * @param {string|number} studentId - Student ID
 * @returns {number|null} Last term cumulative or null if not applicable
 */
export async function getLastTermCumulative(schoolId, classId, subject, currentTerm, studentId) {
  try {
    if (currentTerm === "term1") {
      return null; // No last term for First Term
    }

    if (currentTerm === "term2") {
      // Get total from First Term (would need to fetch from Firebase)
      // For now, return 0 as placeholder
      return 0;
    }

    if (currentTerm === "term3") {
      // Get average of First Term and Second Term totals
      // For now, return 0 as placeholder
      return 0;
    }

    return 0;
  } catch (error) {
    console.error("Error getting last term cumulative:", error);
    return 0;
  }
}

// Get class average for a subject in a term
export async function getClassAverage(schoolId, classId, subject, term, session) {
  try {
    // Fetch scores from Firebase for specific term
    const scores = await getScores(schoolId, classId, subject, term, session);
    
    if (!scores || Object.keys(scores).length === 0) return 0;
    
    let total = 0;
    let count = 0;
    
    for (const [id, score] of Object.entries(scores)) {
      const test1 = parseFloat(score?.test1) || 0;
      const test2 = parseFloat(score?.test2) || 0;
      const exam = parseFloat(score?.exam) || 0;
      const studentTotal = test1 + test2 + exam;
      
      total += studentTotal;
      count++;
    }
    
    return count > 0 ? total / count : 0;
  } catch (error) {
    console.error("Error calculating class average:", error);
    return 0;
  }
}

// Get student's position (rank) in class for a subject
export async function getStudentPosition(schoolId, classId, subject, term, session, studentId) {
  try {
    // Fetch scores from Firebase for specific term
    const scores = await getScores(schoolId, classId, subject, term, session);
    
    // Convert studentId to string to match Firebase keys
    const studentIdStr = studentId.toString();
    
    // If student not in scores yet, they have no position
    if (!scores || !scores[studentIdStr]) return 0;
    
    if (Object.keys(scores).length === 0) return 0;
    
    // Calculate total scores for all students
    const studentScores = [];
    
    for (const [id, score] of Object.entries(scores)) {
      const test1 = parseFloat(score?.test1) || 0;
      const test2 = parseFloat(score?.test2) || 0;
      const exam = parseFloat(score?.exam) || 0;
      const total = test1 + test2 + exam;
      
      studentScores.push({
        id,
        total,
      });
    }
    
    // Sort by total score descending (higher scores get better positions)
    // For ties, maintain insertion order (stable sort)
    studentScores.sort((a, b) => b.total - a.total);
    
    // Find position of current student (1-indexed)
    const position = studentScores.findIndex((s) => s.id === studentIdStr);
    
    // Return position (1-indexed), or 0 if not found
    return position >= 0 ? position + 1 : 0;
  } catch (error) {
    console.error("Error getting student position:", error);
    return 0;
  }
}
/**
 * Set class access code in Firebase
 * @param {string} schoolId - School ID
 * @param {string} classId - Class ID
 * @param {string} hashedPassword - SHA-256 hashed password
 */
export async function setClassAccessCode(schoolId, classId, hashedPassword) {
  try {
    const { setClassTeacherCodeHash } = await import("../../utils/firebaseDatabase");
    await setClassTeacherCodeHash(schoolId, classId, hashedPassword);
    
    console.log(`✅ Class access code set for ${classId}`);
    return true;
  } catch (error) {
    console.error("Error setting class access code:", error);
    throw error;
  }
}

/**
 * Set subject access code in Firebase
 * @param {string} schoolId - School ID
 * @param {string} subjectId - Subject ID
 * @param {string} hashedPassword - SHA-256 hashed password
 */
export async function setSubjectAccessCode(schoolId, subjectId, hashedPassword) {
  try {
    const { setSubjectTeacherCodeHash } = await import("../../utils/firebaseDatabase");
    const [classId, ...rest] = String(subjectId).split("_");
    const parsedSubjectId = rest.join("_");

    if (!classId || !parsedSubjectId) {
      throw new Error("subjectId must be in the form {classId}_{subjectId}");
    }

    await setSubjectTeacherCodeHash(
      schoolId,
      classId,
      parsedSubjectId,
      hashedPassword
    );
    
    console.log(`✅ Subject access code set for ${subjectId}`);
    return true;
  } catch (error) {
    console.error("Error setting subject access code:", error);
    throw error;
  }
}

/**
 * Cleanup malformed score rows for a school.
 * Removes entries keyed by "undefined" or with studentId === "undefined".
 * @param {string} schoolId - School ID
 * @returns {Promise<{removed:number}>}
 */
export async function cleanupMalformedScores(schoolId) {
  const { cleanupUndefinedScoreEntries } = await import("../../utils/firebaseDatabase");
  return cleanupUndefinedScoreEntries(schoolId);
}
