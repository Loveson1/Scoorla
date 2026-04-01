import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

const PROJECT_ID = "demo-scoorla-rules";
const SCHOOL_ID = "impact-arena-academy";
const ACTIVE_SESSION_ID = "session-active";
const ACTIVE_TERM_ID = "term3";
const ACTIVE_TERM_DOC_ID = "term-active-doc";
const INACTIVE_TERM_ID = "term2";
const INACTIVE_TERM_DOC_ID = "term-old-doc";
const CLASS_ID = "jss1";
const STUDENT_ID = "student-1";
const ENROLLMENT_ID = "enrollment-1";
const ADMIN_UID = "admin-uid";
const TEACHER_UID = "teacher-uid";
const SUBJECT_ID = "Agricultural Science";
const SUBJECT_TOKEN = "agricultural_science";
const BST_SUBJECT_ID = "Basic Science and Technology";
const BST_SUBJECT_TOKEN = "basic_science_and_technology";

let testEnv;

const sanitizeDocIdToken = (value) =>
  encodeURIComponent(String(value || ""))
    .replace(/%/g, "_")
    .replace(/\./g, "_");

const buildScoreId = (enrollmentId, termId, subjectId) =>
  `${enrollmentId}__${String(termId || "").trim().toLowerCase()}__${sanitizeDocIdToken(subjectId)}`;

const buildScorePayload = ({
  subjectId = SUBJECT_ID,
  subjectToken = SUBJECT_TOKEN,
  termId = ACTIVE_TERM_ID,
  termDocId = ACTIVE_TERM_DOC_ID,
  scoreId = buildScoreId(ENROLLMENT_ID, termId, subjectId),
} = {}) => ({
  scoreId,
  schoolId: SCHOOL_ID,
  classId: CLASS_ID,
  classToken: CLASS_ID,
  studentId: STUDENT_ID,
  enrollmentId: ENROLLMENT_ID,
  sessionId: ACTIVE_SESSION_ID,
  termId,
  termDocId,
  subjectId,
  subjectToken,
  test1: 8,
  test2: 9,
  exam: 55,
  score: 72,
  updatedAt: "2026-03-09T00:00:00.000Z",
});

async function seedBaseDocuments() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.collection("settings").doc(SCHOOL_ID).set({
      schoolId: SCHOOL_ID,
      activeSessionId: ACTIVE_SESSION_ID,
      activeTermId: ACTIVE_TERM_ID,
      activeTermDocId: ACTIVE_TERM_DOC_ID,
    });

    await db.collection("sessions").doc(ACTIVE_SESSION_ID).set({
      sessionId: ACTIVE_SESSION_ID,
      schoolId: SCHOOL_ID,
      name: "2025/2026",
      isActive: true,
      isArchived: false,
      isEditable: true,
    });

    await db.collection("terms").doc(ACTIVE_TERM_DOC_ID).set({
      schoolId: SCHOOL_ID,
      sessionId: ACTIVE_SESSION_ID,
      alias: ACTIVE_TERM_ID,
      isActive: true,
      isEditable: true,
    });

    await db.collection("terms").doc(INACTIVE_TERM_DOC_ID).set({
      schoolId: SCHOOL_ID,
      sessionId: ACTIVE_SESSION_ID,
      alias: INACTIVE_TERM_ID,
      isActive: false,
      isEditable: false,
    });

    await db.collection("users").doc(ADMIN_UID).set({
      schoolId: SCHOOL_ID,
      role: "admin",
      isActive: true,
    });

    await db.collection("users").doc(TEACHER_UID).set({
      schoolId: SCHOOL_ID,
      role: "subject_teacher",
      isActive: true,
      assignedClasses: [CLASS_ID],
      assignedClassTokens: [CLASS_ID],
      assignedSubjects: [SUBJECT_ID],
      assignedSubjectTokens: [SUBJECT_TOKEN],
      assignedSubjectKeys: [
        SUBJECT_ID,
        `${SCHOOL_ID}__junior__${SUBJECT_TOKEN}`,
        `${SCHOOL_ID}__senior__${SUBJECT_TOKEN}`,
      ],
    });

    await db.collection("enrollments").doc(ENROLLMENT_ID).set({
      enrollmentId: ENROLLMENT_ID,
      schoolId: SCHOOL_ID,
      classId: CLASS_ID,
      sessionId: ACTIVE_SESSION_ID,
      studentId: STUDENT_ID,
    });
  });
}

function adminDb() {
  return testEnv.authenticatedContext(ADMIN_UID).firestore();
}

function teacherDb() {
  return testEnv.authenticatedContext(TEACHER_UID).firestore();
}

async function seedScore(payload) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection("scores").doc(payload.scoreId).set(payload);
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: await fs.readFile("firestore.rules", "utf8"),
    },
  });
});

test.after(async () => {
  await testEnv.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBaseDocuments();
});

test("admin can create a score in the active session and term", async () => {
  const db = adminDb();
  const payload = buildScorePayload();
  await assertSucceeds(db.collection("scores").doc(payload.scoreId).set(payload));
});

test("assigned subject teacher can create a score in the active session and term", async () => {
  const db = teacherDb();
  const payload = buildScorePayload();
  await assertSucceeds(db.collection("scores").doc(payload.scoreId).set(payload));
});

test("admin can query scores for canonical class and subject token", async () => {
  const payload = buildScorePayload({
    subjectId: BST_SUBJECT_ID,
    subjectToken: BST_SUBJECT_TOKEN,
  });
  await seedScore(payload);

  const db = adminDb();
  const scoreQuery = query(
    collection(db, "scores"),
    where("schoolId", "==", SCHOOL_ID),
    where("sessionId", "==", ACTIVE_SESSION_ID),
    where("termId", "==", ACTIVE_TERM_ID),
    where("classId", "==", CLASS_ID),
    where("subjectToken", "==", BST_SUBJECT_TOKEN)
  );

  const snapshot = await assertSucceeds(getDocs(scoreQuery));
  assert.equal(snapshot.docs.length, 1);
  assert.equal(snapshot.docs[0].id, payload.scoreId);
});

test("assigned subject teacher can query scores for canonical class and subject token", async () => {
  const payload = buildScorePayload({
    subjectId: BST_SUBJECT_ID,
    subjectToken: BST_SUBJECT_TOKEN,
  });
  await seedScore(payload);

  const db = teacherDb();
  const scoreQuery = query(
    collection(db, "scores"),
    where("schoolId", "==", SCHOOL_ID),
    where("sessionId", "==", ACTIVE_SESSION_ID),
    where("termId", "==", ACTIVE_TERM_ID),
    where("classId", "==", CLASS_ID),
    where("subjectToken", "==", BST_SUBJECT_TOKEN)
  );

  const snapshot = await assertSucceeds(getDocs(scoreQuery));
  assert.equal(snapshot.docs.length, 1);
  assert.equal(snapshot.docs[0].id, payload.scoreId);
});

test("assigned subject teacher can update an existing malformed legacy score doc", async () => {
  const payload = buildScorePayload();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection("scores").doc(payload.scoreId).set({
      enrollmentId: payload.enrollmentId,
      studentId: payload.studentId,
      class: "JSS 1",
      subject: SUBJECT_ID,
      sessionId: payload.sessionId,
      termId: payload.termId,
      termDocId: payload.termDocId,
      score: 40,
    });
  });

  const db = teacherDb();
  await assertSucceeds(db.collection("scores").doc(payload.scoreId).set(payload, { merge: true }));
});

test("teacher cannot write a score for an unassigned subject", async () => {
  const db = teacherDb();
  const payload = buildScorePayload({
    subjectId: "Mathematics",
    subjectToken: "mathematics",
  });
  await assertFails(db.collection("scores").doc(payload.scoreId).set(payload));
});

test("teacher cannot write a score for a non-active term", async () => {
  const db = teacherDb();
  const payload = buildScorePayload({
    termId: INACTIVE_TERM_ID,
    termDocId: INACTIVE_TERM_DOC_ID,
  });
  await assertFails(db.collection("scores").doc(payload.scoreId).set(payload));
});

test("teacher cannot write a score for another school's data", async () => {
  const db = teacherDb();
  const payload = buildScorePayload({
    scoreId: buildScoreId("enrollment-2", ACTIVE_TERM_ID, SUBJECT_ID),
  });
  payload.schoolId = "another-school";
  await assertFails(db.collection("scores").doc(payload.scoreId).set(payload));
});

test("teacher cannot query scores for an unassigned subject token", async () => {
  const payload = buildScorePayload({
    subjectId: "Mathematics",
    subjectToken: "mathematics",
    scoreId: buildScoreId(ENROLLMENT_ID, ACTIVE_TERM_ID, "Mathematics"),
  });
  await seedScore(payload);

  const db = teacherDb();
  const scoreQuery = query(
    collection(db, "scores"),
    where("schoolId", "==", SCHOOL_ID),
    where("sessionId", "==", ACTIVE_SESSION_ID),
    where("termId", "==", ACTIVE_TERM_ID),
    where("classId", "==", CLASS_ID),
    where("subjectToken", "==", "mathematics")
  );

  await assertFails(getDocs(scoreQuery));
});

test("teacher cannot read another school's score doc", async () => {
  const payload = buildScorePayload({
    scoreId: buildScoreId("enrollment-2", ACTIVE_TERM_ID, BST_SUBJECT_ID),
    subjectId: BST_SUBJECT_ID,
    subjectToken: BST_SUBJECT_TOKEN,
  });
  payload.schoolId = "another-school";
  await seedScore(payload);

  const db = teacherDb();
  await assertFails(getDoc(doc(db, "scores", payload.scoreId)));
});

test("rules test harness seeded active settings as expected", async () => {
  const db = adminDb();
  const snapshot = await db.collection("settings").doc(SCHOOL_ID).get();
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.data()?.activeTermId, ACTIVE_TERM_ID);
});
