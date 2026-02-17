import { db } from "../src/firebase.js";
import { ref, get, update } from "firebase/database";

const schoolId = process.argv[2];

if (!schoolId) {
  console.error("Usage: node scripts/cleanupUndefinedScores.mjs <schoolId>");
  process.exit(1);
}

try {
  console.log(`Cleaning malformed scores for school: ${schoolId}`);
  const scoresRef = ref(db, `schools/${schoolId}/scores`);
  const snapshot = await get(scoresRef);
  if (!snapshot.exists()) {
    console.log("Done. Removed: 0");
    process.exit(0);
  }

  const allScores = snapshot.val();
  const updates = {};
  let removed = 0;

  Object.entries(allScores).forEach(([classId, subjects]) => {
    Object.entries(subjects || {}).forEach(([subjectId, studentScores]) => {
      Object.entries(studentScores || {}).forEach(([studentKey, score]) => {
        const invalidKey = studentKey === "undefined" || !studentKey;
        const invalidPayloadId =
          (score && score.studentId === "undefined") || (score && !score.studentId);
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

  console.log(`Done. Removed: ${removed}`);
  process.exit(0);
} catch (error) {
  console.error("Cleanup failed:", error?.message || error);
  process.exit(2);
}
