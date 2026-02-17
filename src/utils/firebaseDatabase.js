/**
 * Firebase Realtime Database Utilities
 * Handles all database operations for multi-school data storage
 * 
 * Database Structure:
 * schools/
 *   {schoolId}/
 *     profile/ - School information
 *     classes/ - Class definitions
 *     subjects/ - Subject definitions
 *     students/ - Student data
 *     scores/ - Student scores
 *     results/ - Result compilation
 *     accessCodes/ - Teacher access codes (hashed)
 *     settings/ - School settings
 */

import { db } from "../firebase";
import { ref, set, get, update, remove, push, query, orderByChild, equalTo, onValue, off } from "firebase/database";

// ============ SCHOOL PROFILE OPERATIONS ============

/**
 * Create or update school profile
 * @param {string} schoolId - School identifier
 * @param {Object} profileData - School profile data
 * @returns {Promise<void>}
 */
export const setSchoolProfile = async (schoolId, profileData) => {
  try {
    const schoolRef = ref(db, `schools/${schoolId}/profile`);
    await set(schoolRef, {
      ...profileData,
      updatedAt: new Date().toISOString(),
    });
    console.log(`✅ School profile saved for ${schoolId}`);
  } catch (error) {
    console.error("Error saving school profile:", error);
    throw error;
  }
};

/**
 * Get school profile
 * @param {string} schoolId - School identifier
 * @returns {Promise<Object|null>}
 */
export const getSchoolProfile = async (schoolId) => {
  try {
    const schoolRef = ref(db, `schools/${schoolId}/profile`);
    const snapshot = await get(schoolRef);
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Error fetching school profile:", error);
    return null;
  }
};

// ============ CLASSES OPERATIONS ============

/**
 * Create or update a class
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @param {Object} classData - Class information
 * @returns {Promise<void>}
 */
export const setClass = async (schoolId, classId, classData) => {
  try {
    const classRef = ref(db, `schools/${schoolId}/classes/${classId}`);
    await set(classRef, {
      ...classData,
      classId,
      createdAt: classData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    console.log(`✅ Class created: ${classId}`);
  } catch (error) {
    console.error("Error creating class:", error);
    throw error;
  }
};

/**
 * Get all classes for a school
 * @param {string} schoolId - School identifier
 * @returns {Promise<Object>}
 */
export const getClasses = async (schoolId) => {
  try {
    const classesRef = ref(db, `schools/${schoolId}/classes`);
    const snapshot = await get(classesRef);
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Error fetching classes:", error);
    return {};
  }
};

/**
 * Delete a class
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @returns {Promise<void>}
 */
export const deleteClass = async (schoolId, classId) => {
  try {
    const classRef = ref(db, `schools/${schoolId}/classes/${classId}`);
    await remove(classRef);
    console.log(`✅ Class deleted: ${classId}`);
  } catch (error) {
    console.error("Error deleting class:", error);
    throw error;
  }
};

// ============ SUBJECTS OPERATIONS ============

/**
 * Create or update a subject
 * @param {string} schoolId - School identifier
 * @param {string} subjectId - Subject identifier
 * @param {Object} subjectData - Subject information
 * @returns {Promise<void>}
 */
export const setSubject = async (schoolId, subjectId, subjectData) => {
  try {
    const subjectRef = ref(db, `schools/${schoolId}/subjects/${subjectId}`);
    await set(subjectRef, {
      ...subjectData,
      subjectId,
      createdAt: subjectData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    console.log(`✅ Subject created: ${subjectId}`);
  } catch (error) {
    console.error("Error creating subject:", error);
    throw error;
  }
};

/**
 * Get all subjects for a school
 * @param {string} schoolId - School identifier
 * @returns {Promise<Object>}
 */
export const getSubjects = async (schoolId) => {
  try {
    const subjectsRef = ref(db, `schools/${schoolId}/subjects`);
    const snapshot = await get(subjectsRef);
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Error fetching subjects:", error);
    return {};
  }
};

/**
 * Delete a subject
 * @param {string} schoolId - School identifier
 * @param {string} subjectId - Subject identifier
 * @returns {Promise<void>}
 */
export const deleteSubject = async (schoolId, subjectId) => {
  try {
    const subjectRef = ref(db, `schools/${schoolId}/subjects/${subjectId}`);
    await remove(subjectRef);
    console.log(`✅ Subject deleted: ${subjectId}`);
  } catch (error) {
    console.error("Error deleting subject:", error);
    throw error;
  }
};

// ============ STUDENTS OPERATIONS ============

/**
 * Add a student to a class
 * @param {string} schoolId - School identifier
 * @param {string} studentData - Student information
 * @returns {Promise<string>} - New student ID
 */
export const addStudent = async (schoolId, studentData) => {
  try {
    const studentsRef = ref(db, `schools/${schoolId}/students`);
    const newStudentRef = push(studentsRef);
    await set(newStudentRef, {
      ...studentData,
      studentId: newStudentRef.key,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    console.log(`✅ Student added: ${newStudentRef.key}`);
    return newStudentRef.key;
  } catch (error) {
    console.error("Error adding student:", error);
    throw error;
  }
};

/**
 * Get all students for a school
 * @param {string} schoolId - School identifier
 * @returns {Promise<Object>}
 */
export const getStudents = async (schoolId) => {
  try {
    const studentsRef = ref(db, `schools/${schoolId}/students`);
    const snapshot = await get(studentsRef);
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Error fetching students:", error);
    return {};
  }
};

/**
 * Get students in a specific class
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @returns {Promise<Object>}
 */
export const getStudentsByClass = async (schoolId, classId) => {
  try {
    const studentsRef = ref(db, `schools/${schoolId}/students`);
    const snapshot = await get(studentsRef);
    if (!snapshot.exists()) return {};
    
    const allStudents = snapshot.val();
    const classStudents = {};
    
    Object.entries(allStudents).forEach(([studentId, student]) => {
      if (student.classId === classId) {
        classStudents[studentId] = student;
      }
    });
    
    return classStudents;
  } catch (error) {
    console.error("Error fetching class students:", error);
    return {};
  }
};

/**
 * Update student information
 * @param {string} schoolId - School identifier
 * @param {string} studentId - Student identifier
 * @param {Object} updateData - Fields to update
 * @returns {Promise<void>}
 */
export const updateStudent = async (schoolId, studentId, updateData) => {
  try {
    const studentRef = ref(db, `schools/${schoolId}/students/${studentId}`);
    await update(studentRef, {
      ...updateData,
      updatedAt: new Date().toISOString(),
    });
    console.log(`✅ Student updated: ${studentId}`);
  } catch (error) {
    console.error("Error updating student:", error);
    throw error;
  }
};

/**
 * Delete a student
 * @param {string} schoolId - School identifier
 * @param {string} studentId - Student identifier
 * @returns {Promise<void>}
 */
export const deleteStudent = async (schoolId, studentId) => {
  try {
    const studentRef = ref(db, `schools/${schoolId}/students/${studentId}`);
    await remove(studentRef);
    console.log(`✅ Student deleted: ${studentId}`);
  } catch (error) {
    console.error("Error deleting student:", error);
    throw error;
  }
};

// ============ SCORES OPERATIONS ============

/**
 * Save student score for a subject in a class
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @param {string} subjectId - Subject identifier
 * @param {string} studentId - Student identifier
 * @param {number} score - Score value
 * @returns {Promise<void>}
 */
export const setScore = async (schoolId, classId, subjectId, studentId, scoreData) => {
  try {
    const scoreRef = ref(db, `schools/${schoolId}/scores/${classId}/${subjectId}/${studentId}`);
    await set(scoreRef, {
      ...scoreData,
      studentId,
      subjectId,
      classId,
      recordedAt: new Date().toISOString(),
    });
    console.log(`✅ Score saved for ${studentId} in ${subjectId}`);
  } catch (error) {
    console.error("Error saving score:", error);
    throw error;
  }
};

/**
 * Get all scores for a subject in a class
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @param {string} subjectId - Subject identifier
 * @returns {Promise<Object>}
 */
export const getScoresBySubject = async (schoolId, classId, subjectId) => {
  try {
    const scoresRef = ref(db, `schools/${schoolId}/scores/${classId}/${subjectId}`);
    const snapshot = await get(scoresRef);
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Error fetching scores:", error);
    return {};
  }
};

/**
 * Get student's scores in a class
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @param {string} studentId - Student identifier
 * @returns {Promise<Object>}
 */
export const getStudentScores = async (schoolId, classId, studentId) => {
  try {
    const scoresRef = ref(db, `schools/${schoolId}/scores/${classId}`);
    const snapshot = await get(scoresRef);
    if (!snapshot.exists()) return {};
    
    const allScores = snapshot.val();
    const studentScores = {};
    
    Object.entries(allScores).forEach(([subjectId, subjects]) => {
      if (subjects[studentId]) {
        studentScores[subjectId] = subjects[studentId];
      }
    });
    
    return studentScores;
  } catch (error) {
    console.error("Error fetching student scores:", error);
    return {};
  }
};

/**
 * Remove malformed score entries where student key or payload studentId is "undefined"
 * @param {string} schoolId - School identifier
 * @returns {Promise<{removed: number}>}
 */
export const cleanupUndefinedScoreEntries = async (schoolId) => {
  try {
    const scoresRef = ref(db, `schools/${schoolId}/scores`);
    const snapshot = await get(scoresRef);
    if (!snapshot.exists()) return { removed: 0 };

    const allScores = snapshot.val();
    const updates = {};
    let removed = 0;

    Object.entries(allScores).forEach(([classId, subjects]) => {
      Object.entries(subjects || {}).forEach(([subjectId, studentScores]) => {
        Object.entries(studentScores || {}).forEach(([studentKey, score]) => {
          const invalidKey = studentKey === "undefined" || !studentKey;
          const invalidPayloadId = (score && score.studentId === "undefined") || (score && !score.studentId);
          if (invalidKey || invalidPayloadId) {
            updates[`schools/${schoolId}/scores/${classId}/${subjectId}/${studentKey}`] = null;
            removed += 1;
          }
        });
      });
    });

    if (removed > 0) {
      await update(ref(db), updates);
    }

    console.log(`✅ Removed ${removed} malformed score entr${removed === 1 ? "y" : "ies"}`);
    return { removed };
  } catch (error) {
    console.error("Error cleaning malformed score entries:", error);
    throw error;
  }
};

// ============ RESULTS OPERATIONS ============

/**
 * Save compiled result for a student
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @param {string} studentId - Student identifier
 * @param {Object} resultData - Compiled result
 * @returns {Promise<void>}
 */
export const setResult = async (schoolId, classId, studentId, resultData) => {
  try {
    const resultRef = ref(db, `schools/${schoolId}/results/${classId}/${studentId}`);
    await set(resultRef, {
      ...resultData,
      studentId,
      classId,
      compiledAt: new Date().toISOString(),
    });
    console.log(`✅ Result saved for ${studentId}`);
  } catch (error) {
    console.error("Error saving result:", error);
    throw error;
  }
};

/**
 * Get result for a student
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @param {string} studentId - Student identifier
 * @returns {Promise<Object|null>}
 */
export const getResult = async (schoolId, classId, studentId) => {
  try {
    const resultRef = ref(db, `schools/${schoolId}/results/${classId}/${studentId}`);
    const snapshot = await get(resultRef);
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Error fetching result:", error);
    return null;
  }
};

/**
 * Get all results for a class
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @returns {Promise<Object>}
 */
export const getResultsByClass = async (schoolId, classId) => {
  try {
    const resultsRef = ref(db, `schools/${schoolId}/results/${classId}`);
    const snapshot = await get(resultsRef);
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Error fetching class results:", error);
    return {};
  }
};

// ============ TEACHER ACCESS CODES ============

/**
 * Save hashed access code for class teachers
 * @param {string} schoolId - School identifier
 * @param {string} codeId - Code identifier
 * @param {string} codeHash - Hashed code
 * @param {Object} metadata - Code metadata
 * @returns {Promise<void>}
 */
export const setClassAccessCode = async (schoolId, codeId, codeHash, metadata) => {
  try {
    const codeRef = ref(db, `schools/${schoolId}/accessCodes/classTeacherCodes/${codeId}`);
    await set(codeRef, {
      hash: codeHash,
      classId: metadata.classId,
      createdAt: new Date().toISOString(),
      expiresAt: metadata.expiresAt || null,
      isActive: true,
      ...metadata,
    });
    console.log(`✅ Class access code created`);
  } catch (error) {
    console.error("Error saving class code:", error);
    throw error;
  }
};

/**
 * Save hashed access code for subject teachers
 * @param {string} schoolId - School identifier
 * @param {string} codeId - Code identifier
 * @param {string} codeHash - Hashed code
 * @param {Object} metadata - Code metadata
 * @returns {Promise<void>}
 */
export const setSubjectAccessCode = async (schoolId, codeId, codeHash, metadata) => {
  try {
    const codeRef = ref(db, `schools/${schoolId}/accessCodes/subjectTeacherCodes/${codeId}`);
    await set(codeRef, {
      hash: codeHash,
      classId: metadata.classId,
      subjectId: metadata.subjectId,
      createdAt: new Date().toISOString(),
      expiresAt: metadata.expiresAt || null,
      isActive: true,
      ...metadata,
    });
    console.log(`✅ Subject access code created`);
  } catch (error) {
    console.error("Error saving subject code:", error);
    throw error;
  }
};

/**
 * Set/update class teacher code hash using classId path key.
 * Path: schools/{schoolId}/accessCodes/classTeacherCodes/{classId}
 * @param {string} schoolId
 * @param {string} classId
 * @param {string} codeHash
 * @returns {Promise<void>}
 */
export const setClassTeacherCodeHash = async (schoolId, classId, codeHash) => {
  try {
    const codeRef = ref(
      db,
      `schools/${schoolId}/accessCodes/classTeacherCodes/${classId}`
    );
    await set(codeRef, {
      hash: codeHash,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error saving class teacher code hash:", error);
    throw error;
  }
};

/**
 * Set/update subject teacher code hash using classId + subjectId path key.
 * Path: schools/{schoolId}/accessCodes/subjectTeacherCodes/{classId}/{subjectId}
 * @param {string} schoolId
 * @param {string} classId
 * @param {string} subjectId
 * @param {string} codeHash
 * @returns {Promise<void>}
 */
export const setSubjectTeacherCodeHash = async (
  schoolId,
  classId,
  subjectId,
  codeHash
) => {
  try {
    const codeRef = ref(
      db,
      `schools/${schoolId}/accessCodes/subjectTeacherCodes/${classId}/${subjectId}`
    );
    await set(codeRef, {
      hash: codeHash,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error saving subject teacher code hash:", error);
    throw error;
  }
};

/**
 * Get class teacher access hash entry.
 * @param {string} schoolId
 * @param {string} classId
 * @returns {Promise<Object|null>}
 */
export const getClassTeacherCode = async (schoolId, classId) => {
  try {
    const codeRef = ref(
      db,
      `schools/${schoolId}/accessCodes/classTeacherCodes/${classId}`
    );
    const snapshot = await get(codeRef);
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Error fetching class teacher code:", error);
    return null;
  }
};

/**
 * Get subject teacher access hash entry.
 * @param {string} schoolId
 * @param {string} classId
 * @param {string} subjectId
 * @returns {Promise<Object|null>}
 */
export const getSubjectTeacherCode = async (schoolId, classId, subjectId) => {
  try {
    const codeRef = ref(
      db,
      `schools/${schoolId}/accessCodes/subjectTeacherCodes/${classId}/${subjectId}`
    );
    const snapshot = await get(codeRef);
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    console.error("Error fetching subject teacher code:", error);
    return null;
  }
};

/**
 * Get all class teacher code entries for a school.
 * @param {string} schoolId
 * @returns {Promise<Object>}
 */
export const getAllClassTeacherCodes = async (schoolId) => {
  try {
    const codesRef = ref(db, `schools/${schoolId}/accessCodes/classTeacherCodes`);
    const snapshot = await get(codesRef);
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Error fetching all class teacher codes:", error);
    return {};
  }
};

/**
 * Get all subject teacher code entries for a school.
 * Returns nested object: { [classId]: { [subjectId]: { hash, updatedAt } } }
 * @param {string} schoolId
 * @returns {Promise<Object>}
 */
export const getAllSubjectTeacherCodes = async (schoolId) => {
  try {
    const codesRef = ref(
      db,
      `schools/${schoolId}/accessCodes/subjectTeacherCodes`
    );
    const snapshot = await get(codesRef);
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Error fetching all subject teacher codes:", error);
    return {};
  }
};

/**
 * Get all access codes for a class
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @returns {Promise<Object>}
 */
export const getClassAccessCodes = async (schoolId, classId) => {
  try {
    const codesRef = ref(db, `schools/${schoolId}/accessCodes/classTeacherCodes`);
    const snapshot = await get(codesRef);
    if (!snapshot.exists()) return {};
    
    const allCodes = snapshot.val();
    const classCodes = {};
    
    Object.entries(allCodes).forEach(([codeId, code]) => {
      if (code.classId === classId && code.isActive) {
        classCodes[codeId] = { ...code, codeId };
      }
    });
    
    return classCodes;
  } catch (error) {
    console.error("Error fetching class codes:", error);
    return {};
  }
};

/**
 * Get all access codes for a subject
 * @param {string} schoolId - School identifier
 * @param {string} classId - Class identifier
 * @param {string} subjectId - Subject identifier
 * @returns {Promise<Object>}
 */
export const getSubjectAccessCodes = async (schoolId, classId, subjectId) => {
  try {
    const codesRef = ref(db, `schools/${schoolId}/accessCodes/subjectTeacherCodes`);
    const snapshot = await get(codesRef);
    if (!snapshot.exists()) return {};
    
    const allCodes = snapshot.val();
    const subjectCodes = {};
    
    Object.entries(allCodes).forEach(([codeId, code]) => {
      if (code.classId === classId && code.subjectId === subjectId && code.isActive) {
        subjectCodes[codeId] = { ...code, codeId };
      }
    });
    
    return subjectCodes;
  } catch (error) {
    console.error("Error fetching subject codes:", error);
    return {};
  }
};

/**
 * Deactivate an access code
 * @param {string} schoolId - School identifier
 * @param {string} codeType - 'class' or 'subject'
 * @param {string} codeId - Code identifier
 * @returns {Promise<void>}
 */
export const deactivateAccessCode = async (schoolId, codeType, codeId) => {
  try {
    const type = codeType === 'class' ? 'classTeacherCodes' : 'subjectTeacherCodes';
    const codeRef = ref(db, `schools/${schoolId}/accessCodes/${type}/${codeId}`);
    await update(codeRef, { isActive: false, deactivatedAt: new Date().toISOString() });
    console.log(`✅ Access code deactivated`);
  } catch (error) {
    console.error("Error deactivating code:", error);
    throw error;
  }
};

// ============ SETTINGS OPERATIONS ============

/**
 * Save school settings
 * @param {string} schoolId - School identifier
 * @param {Object} settings - Settings object
 * @returns {Promise<void>}
 */
export const setSchoolSettings = async (schoolId, settings) => {
  try {
    const settingsRef = ref(db, `schools/${schoolId}/settings`);
    await set(settingsRef, {
      ...settings,
      updatedAt: new Date().toISOString(),
    });
    console.log(`✅ School settings saved`);
  } catch (error) {
    console.error("Error saving settings:", error);
    throw error;
  }
};

/**
 * Get school settings
 * @param {string} schoolId - School identifier
 * @returns {Promise<Object>}
 */
export const getSchoolSettings = async (schoolId) => {
  try {
    const settingsRef = ref(db, `schools/${schoolId}/settings`);
    const snapshot = await get(settingsRef);
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error("Error fetching settings:", error);
    return {};
  }
};

// ============ REAL-TIME LISTENERS ============

/**
 * Listen to real-time changes for a school's data
 * @param {string} schoolId - School identifier
 * @param {string} path - Database path
 * @param {Function} callback - Called with data updates
 * @returns {Function} Unsubscribe function
 */
export const subscribeToPath = (schoolId, path, callback) => {
  try {
    const dataRef = ref(db, `schools/${schoolId}/${path}`);
    const unsubscribe = onValue(dataRef, (snapshot) => {
      callback(snapshot.exists() ? snapshot.val() : null);
    });
    return unsubscribe;
  } catch (error) {
    console.error("Error subscribing to path:", error);
    return () => {};
  }
};

export default {
  // School operations
  setSchoolProfile,
  getSchoolProfile,
  
  // Class operations
  setClass,
  getClasses,
  deleteClass,
  
  // Subject operations
  setSubject,
  getSubjects,
  deleteSubject,
  
  // Student operations
  addStudent,
  getStudents,
  getStudentsByClass,
  updateStudent,
  deleteStudent,
  
  // Score operations
  setScore,
  getScoresBySubject,
  getStudentScores,
  cleanupUndefinedScoreEntries,
  
  // Result operations
  setResult,
  getResult,
  getResultsByClass,
  
  // Access code operations
  setClassAccessCode,
  setSubjectAccessCode,
  setClassTeacherCodeHash,
  setSubjectTeacherCodeHash,
  getClassTeacherCode,
  getSubjectTeacherCode,
  getAllClassTeacherCodes,
  getAllSubjectTeacherCodes,
  getClassAccessCodes,
  getSubjectAccessCodes,
  deactivateAccessCode,
  
  // Settings
  setSchoolSettings,
  getSchoolSettings,
  
  // Real-time
  subscribeToPath,
};
