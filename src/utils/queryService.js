import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { auth, firestore } from "../firebase";
import { resolveSession, resolveTerm } from "./sessionContextService";
import { instrumentFirestoreRead } from "../services/firestoreInstrumentation";
import { getCachedValue, setCachedValue } from "../services/dataCache";
import {
  ensureUserScope,
  getCachedUserScopeForSchool,
} from "./userScopeCache";

const DASHBOARD_STATS_TTL_MS = 30_000;

const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") {
    const nanos = typeof value?.nanoseconds === "number" ? value.nanoseconds : 0;
    return value.seconds * 1000 + Math.floor(nanos / 1_000_000);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeTermToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

const toTermAlias = (value) => {
  const token = normalizeTermToken(value);
  if (!token) return "";
  if (["term1", "1", "1st", "1stterm", "firstterm"].includes(token)) return "term1";
  if (["term2", "2", "2nd", "2ndterm", "secondterm"].includes(token)) return "term2";
  if (["term3", "3", "3rd", "3rdterm", "thirdterm"].includes(token)) return "term3";
  return "";
};

const getTermSortOrder = (value, fallback = 0) => {
  const alias = toTermAlias(value);
  if (alias === "term1") return 1;
  if (alias === "term2") return 2;
  if (alias === "term3") return 3;
  return fallback;
};

const getEnrollmentEntryTermOrder = (enrollment) => {
  const rawOrder = Number(enrollment?.entryTermOrder ?? enrollment?.createdTermOrder);
  if (Number.isFinite(rawOrder) && rawOrder > 0) {
    return rawOrder;
  }

  return getTermSortOrder(
    enrollment?.entryTermId || enrollment?.createdTermId || enrollment?.termId,
    0,
  );
};

const normalizeAssignments = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
};

const getCurrentUserScope = async (schoolId) => {
  const currentUid = String(auth?.currentUser?.uid || "").trim();
  if (!currentUid) {
    return {
      role: "",
      isAdmin: false,
      assignedClasses: [],
      assignedSubjects: [],
    };
  }

  const cachedScope = getCachedUserScopeForSchool(schoolId, currentUid);
  if (cachedScope) {
    return {
      role: cachedScope.role,
      isAdmin: cachedScope.isAdmin,
      assignedClasses: cachedScope.assignedClasses,
      assignedSubjects: cachedScope.assignedSubjects,
    };
  }

  const userScope = await ensureUserScope(currentUid, {
    screen: "Shared",
    action: "query_service_user_scope",
  });
  const userData = userScope || {};
  const userSchoolId = String(userData?.schoolId || "").trim();
  const role = String(userData?.role || "").trim().toLowerCase();
  const sameSchool = userSchoolId && String(schoolId || "").trim() === userSchoolId;

  return {
    role,
    isAdmin: sameSchool && role === "admin",
    assignedClasses: sameSchool ? normalizeAssignments(userData?.assignedClasses) : [],
    assignedSubjects: sameSchool ? normalizeAssignments(userData?.assignedSubjects) : [],
  };
};

const fetchStudentsByIds = async (schoolId, studentIds) => {
  const idChunks = chunkArray(
    [...new Set((studentIds || []).map((id) => String(id || "").trim()).filter(Boolean))],
    30
  );
  const studentsById = {};
  for (const chunk of idChunks) {
    if (chunk.length === 0) continue;
    try {
      const snap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "students"),
            where("schoolId", "==", String(schoolId || "").trim()),
            where(documentId(), "in", chunk)
          )
        ),
        {
          screen: "QueryService",
          action: "fetch_students_by_ids",
          target: "students",
        }
      );
      snap.docs.forEach((row) => {
        studentsById[row.id] = { id: row.id, ...row.data() };
      });
    } catch (error) {
      const code = String(error?.code || "");
      if (!code.includes("permission-denied")) {
        throw error;
      }
      const fallbackSnaps = await Promise.all(
        chunk.map((id) =>
          instrumentFirestoreRead(getDoc(doc(firestore, "students", id)), {
            screen: "QueryService",
            action: "fetch_students_by_ids_fallback",
            target: `students/${id}`,
          })
        )
      );
      fallbackSnaps.forEach((snap) => {
        if (!snap.exists()) return;
        studentsById[snap.id] = { id: snap.id, ...snap.data() };
      });
    }
  }
  return studentsById;
};

const fetchDocsByIds = async (collectionName, ids, { schoolId = "" } = {}) => {
  const chunks = chunkArray(
    [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))],
    30
  );
  const records = {};
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    try {
      const normalizedSchoolId = String(schoolId || "").trim();
      const scopedConstraints = normalizedSchoolId
        ? [where("schoolId", "==", normalizedSchoolId), where(documentId(), "in", chunk)]
        : [where(documentId(), "in", chunk)];
      const snap = await instrumentFirestoreRead(
        getDocs(query(collection(firestore, collectionName), ...scopedConstraints)),
        {
          screen: "QueryService",
          action: "fetch_docs_by_ids",
          target: collectionName,
        }
      );
      snap.docs.forEach((row) => {
        records[row.id] = { id: row.id, ...row.data() };
      });
    } catch (error) {
      const code = String(error?.code || "");
      if (!code.includes("permission-denied")) {
        throw error;
      }
      const fallbackSnaps = await Promise.all(
        chunk.map((id) =>
          instrumentFirestoreRead(getDoc(doc(firestore, collectionName, id)), {
            screen: "QueryService",
            action: "fetch_docs_by_ids_fallback",
            target: `${collectionName}/${id}`,
          })
        )
      );
      fallbackSnaps.forEach((snap) => {
        if (!snap.exists()) return;
        records[snap.id] = { id: snap.id, ...snap.data() };
      });
    }
  }
  return records;
};

/**
 * Get students in class for a specific session (enrollment model).
 */
export const getStudentsInClass = async ({ schoolId, classId, sessionId, termId }) => {
  try {
    if (!schoolId) throw new Error("schoolId is required");
    if (!classId) throw new Error("classId is required");

    const resolvedSessionId = await resolveSession(sessionId, schoolId);
    const resolvedTermId = await resolveTerm(termId, schoolId);
    const selectedTermOrder = getTermSortOrder(resolvedTermId, 0);
    if (!resolvedSessionId) return [];

    let enrollmentsSnap;
    try {
      enrollmentsSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "enrollments"),
            where("schoolId", "==", schoolId),
            where("sessionId", "==", resolvedSessionId),
            where("classId", "==", classId)
          )
        ),
        {
          screen: "ClassDashboard",
          action: "students_in_class_query",
          target: `enrollments:${classId}`,
        }
      );
    } catch {
      // Fallback when composite index is missing.
      enrollmentsSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "enrollments"),
            where("schoolId", "==", schoolId),
            where("sessionId", "==", resolvedSessionId)
          )
        ),
        {
          screen: "ClassDashboard",
          action: "students_in_class_query_fallback",
          target: `enrollments:${resolvedSessionId}`,
        }
      );
    }

    const enrollments = enrollmentsSnap.docs
      .map((row) => ({ id: row.id, ...row.data() }))
      .filter((row) => {
        if (String(row?.classId || "") !== String(classId)) return false;
        if (!selectedTermOrder) return true;
        const entryTermOrder = getEnrollmentEntryTermOrder(row);
        if (!entryTermOrder) return true;
        return entryTermOrder <= selectedTermOrder;
      });
    if (enrollments.length === 0) return [];

    const studentsById = await fetchStudentsByIds(
      schoolId,
      enrollments.map((row) => row.studentId)
    );

    return enrollments
      .map((enrollment) => {
        const student = studentsById[enrollment.studentId] || null;
        if (!student) return null;
        return {
          enrollmentId: enrollment.id || enrollment.enrollmentId,
          studentId: enrollment.studentId,
          classId: enrollment.classId,
          sessionId: enrollment.sessionId,
          enrollment,
          student,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        String(a?.student?.name || "").localeCompare(String(b?.student?.name || ""))
      );
  } catch (error) {
    console.error("Error fetching students in class:", error);
    return [];
  }
};

/**
 * Get class term results from Firestore scores.
 */
export const getClassResults = async ({ schoolId, classId, termId, sessionId }) => {
  let resolvedTermId = termId || "term1";
  try {
    if (!schoolId) throw new Error("schoolId is required");
    if (!classId) throw new Error("classId is required");

    const resolvedSessionId = await resolveSession(sessionId, schoolId);
    resolvedTermId = await resolveTerm(termId, schoolId);
    if (!resolvedSessionId) {
      return {
        schoolId,
        classId,
        termId: resolvedTermId,
        sessionId: null,
        totalStudents: 0,
        totalScores: 0,
        results: [],
      };
    }

    const studentsInClass = await getStudentsInClass({
      schoolId,
      classId,
      termId: resolvedTermId,
      sessionId: resolvedSessionId,
    });
    if (studentsInClass.length === 0) {
      return {
        schoolId,
        classId,
        termId: resolvedTermId,
        sessionId: resolvedSessionId,
        totalStudents: 0,
        totalScores: 0,
        results: [],
      };
    }

    let scoresSnap;
    try {
      scoresSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "scores"),
            where("schoolId", "==", schoolId),
            where("sessionId", "==", resolvedSessionId),
            where("termId", "==", resolvedTermId),
            where("classId", "==", classId)
          )
        ),
        {
          screen: "ResultPreview",
          action: "class_results_scores_query",
          target: `scores:${classId}:${resolvedTermId}`,
        }
      );
    } catch {
      scoresSnap = await instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "scores"),
            where("schoolId", "==", schoolId),
            where("sessionId", "==", resolvedSessionId),
            where("termId", "==", resolvedTermId)
          )
        ),
        {
          screen: "ResultPreview",
          action: "class_results_scores_query_fallback",
          target: `scores:${resolvedTermId}`,
        }
      );
    }

    const scoresByEnrollment = {};
    scoresSnap.docs.forEach((row) => {
      const data = row.data() || {};
      if (String(data?.classId || "") !== String(classId)) return;
      const enrollmentId = String(data?.enrollmentId || "").trim();
      if (!enrollmentId) return;
      if (!scoresByEnrollment[enrollmentId]) scoresByEnrollment[enrollmentId] = [];
      scoresByEnrollment[enrollmentId].push({
        ...data,
        scoreId: data?.scoreId || row.id,
      });
    });

    const results = studentsInClass.map((row) => {
      const enrollmentScores = scoresByEnrollment[row.enrollmentId] || [];
      const totalScore = enrollmentScores.reduce(
        (sum, entry) =>
          sum +
          (Number(entry?.score) ||
            Number(entry?.test1 || 0) + Number(entry?.test2 || 0) + Number(entry?.exam || 0)),
        0
      );
      const averageScore =
        enrollmentScores.length > 0 ? totalScore / enrollmentScores.length : 0;

      return {
        enrollmentId: row.enrollmentId,
        studentId: row.studentId,
        student: row.student,
        scores: enrollmentScores,
        totalScore,
        averageScore,
      };
    });

    return {
      schoolId,
      classId,
      termId: resolvedTermId,
      sessionId: resolvedSessionId,
      totalStudents: studentsInClass.length,
      totalScores: scoresSnap.size,
      results,
    };
  } catch (error) {
    console.error("Error fetching class results:", error);
    return {
      schoolId,
      classId,
      termId: resolvedTermId,
      sessionId: null,
      totalStudents: 0,
      totalScores: 0,
      results: [],
    };
  }
};

/**
 * Get full enrollment + score history for a student.
 */
export const getStudentFullHistory = async (studentId, schoolId) => {
  try {
    if (!studentId) throw new Error("studentId is required");
    if (!schoolId) throw new Error("schoolId is required");

    const studentSnap = await getDoc(doc(firestore, "students", String(studentId)));
    const student = studentSnap.exists() ? { id: studentSnap.id, ...studentSnap.data() } : null;

    const enrollmentsSnap = await getDocs(
      query(
        collection(firestore, "enrollments"),
        where("schoolId", "==", schoolId),
        where("studentId", "==", String(studentId))
      )
    );
    const enrollmentRows = enrollmentsSnap.docs
      .map((row) => ({ id: row.id, ...row.data() }))
      .sort((a, b) => toMillis(b?.createdAt) - toMillis(a?.createdAt));
    if (enrollmentRows.length === 0) {
      return {
        schoolId,
        studentId,
        student,
        enrollments: [],
        totalEnrollments: 0,
        totalScores: 0,
      };
    }

    const classesById = await fetchDocsByIds(
      "classes",
      enrollmentRows.map((row) => row.classId),
      { schoolId }
    );
    const sessionsById = await fetchDocsByIds(
      "sessions",
      enrollmentRows.map((row) => row.sessionId),
      { schoolId }
    );

    const normalizedEnrollments = [];
    let totalScores = 0;
    for (const enrollment of enrollmentRows) {
      const enrollmentId = enrollment.enrollmentId || enrollment.id;
      const scoresSnap = await getDocs(
        query(
          collection(firestore, "scores"),
          where("schoolId", "==", schoolId),
          where("enrollmentId", "==", enrollmentId)
        )
      );
      const scores = scoresSnap.docs.map((row) => ({
        scoreId: row.id,
        ...row.data(),
      }));
      totalScores += scores.length;

      normalizedEnrollments.push({
        enrollmentId,
        enrollment,
        class: classesById[enrollment.classId] || null,
        session: sessionsById[enrollment.sessionId] || null,
        scores,
        scoreCount: scores.length,
      });
    }

    return {
      schoolId,
      studentId,
      student,
      enrollments: normalizedEnrollments,
      totalEnrollments: normalizedEnrollments.length,
      totalScores,
    };
  } catch (error) {
    console.error("Error fetching student full history:", error);
    return null;
  }
};

/**
 * Get dashboard stats for a session (Firestore).
 */
export const getSessionDashboardStats = async (schoolId, sessionId) => {
  try {
    if (!schoolId) throw new Error("schoolId is required");

    const resolvedSessionId = await resolveSession(sessionId, schoolId);
    const userScope = await getCurrentUserScope(schoolId);
    const cacheKey = `session_dashboard_stats::${schoolId}::${resolvedSessionId || "none"}::${
      userScope.isAdmin ? "admin" : "staff"
    }`;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      return cached;
    }

    let classes = [];
    if (userScope.isAdmin) {
      const classesSnap = await instrumentFirestoreRead(
        getDocs(
          query(collection(firestore, "classes"), where("schoolId", "==", schoolId))
        ),
        {
          screen: "SchoolDashboard",
          action: "dashboard_classes_query",
          target: `classes:${schoolId}`,
        }
      );
      classes = classesSnap.docs.map((row) => ({ id: row.id, ...row.data() }));
    } else {
      classes = (userScope.assignedClasses || []).map((classId) => ({
        id: classId,
        classId,
      }));
    }

    if (!resolvedSessionId) {
      const emptyPayload = {
        schoolId,
        sessionId: null,
        totalEnrollments: 0,
        totalStudents: 0,
        totalClasses: classes.length,
        totalTerms: 0,
        totalScores: 0,
        classBreakdown: {},
        termBreakdown: {},
      };
      setCachedValue(cacheKey, emptyPayload, DASHBOARD_STATS_TTL_MS);
      return emptyPayload;
    }

    const [schoolSnap, termsSnap] = await Promise.all([
      instrumentFirestoreRead(getDoc(doc(firestore, "schools", schoolId)), {
        screen: "SchoolDashboard",
        action: "dashboard_school_doc",
        target: `schools/${schoolId}`,
      }),
      instrumentFirestoreRead(
        getDocs(
          query(
            collection(firestore, "terms"),
            where("schoolId", "==", schoolId),
            where("sessionId", "==", resolvedSessionId)
          )
        ),
        {
          screen: "SchoolDashboard",
          action: "dashboard_terms_query",
          target: `terms:${resolvedSessionId}`,
        }
      ),
    ]);

    const schoolData = schoolSnap.exists() ? schoolSnap.data() || {} : {};
    const counts = schoolData?.counts || {};
    const payload = {
      schoolId,
      sessionId: resolvedSessionId,
      totalEnrollments: Number(counts?.enrollments) || 0,
      totalStudents: Number(counts?.students) || 0,
      totalClasses: classes.length,
      totalTerms: termsSnap.size,
      totalScores: 0,
      classBreakdown: {},
      termBreakdown: {},
    };
    setCachedValue(cacheKey, payload, DASHBOARD_STATS_TTL_MS);
    return payload;
  } catch (error) {
    console.error("Error fetching session dashboard stats:", error);
    return {
      schoolId,
      sessionId: null,
      totalEnrollments: 0,
      totalStudents: 0,
      totalClasses: 0,
      totalTerms: 0,
      totalScores: 0,
      classBreakdown: {},
      termBreakdown: {},
    };
  }
};

export default {
  getStudentsInClass,
  getClassResults,
  getStudentFullHistory,
  getSessionDashboardStats,
};
