import {
  getAllClassTeacherCodes,
  getAllSubjectTeacherCodes,
  getClassTeacherCode,
  getSubjectTeacherCode,
  setClassTeacherCodeHash,
  setSubjectTeacherCodeHash,
} from "./firebaseDatabase";
import {
  generateSixDigitCode,
  hashPassword,
  verifyPassword,
} from "./passwordUtils";

export const generateAccessCode = generateSixDigitCode;
export const hashAccessCode = hashPassword;
export const verifyAccessCode = verifyPassword;

export const createClassAccessCode = async (schoolId, classId) => {
  const plainCode = generateSixDigitCode();
  const codeHash = await hashPassword(plainCode);
  await setClassTeacherCodeHash(schoolId, classId, codeHash);
  return {
    classId,
    plainCode,
    updatedAt: new Date().toISOString(),
  };
};

export const createSubjectAccessCode = async (schoolId, classId, subjectId) => {
  const plainCode = generateSixDigitCode();
  const codeHash = await hashPassword(plainCode);
  await setSubjectTeacherCodeHash(schoolId, classId, subjectId, codeHash);
  return {
    classId,
    subjectId,
    plainCode,
    updatedAt: new Date().toISOString(),
  };
};

export const resetClassAccessCode = async (schoolId, classId) =>
  createClassAccessCode(schoolId, classId);

export const resetSubjectAccessCode = async (schoolId, classId, subjectId) =>
  createSubjectAccessCode(schoolId, classId, subjectId);

export const listClassAccessCodes = async (schoolId) => {
  const codes = await getAllClassTeacherCodes(schoolId);
  return Object.entries(codes || {}).map(([classId, value]) => ({
    classId,
    updatedAt: value?.updatedAt || null,
    hasHash: Boolean(value?.hash),
  }));
};

export const listSubjectAccessCodes = async (schoolId) => {
  const codes = await getAllSubjectTeacherCodes(schoolId);
  const rows = [];
  Object.entries(codes || {}).forEach(([classId, subjects]) => {
    Object.entries(subjects || {}).forEach(([subjectId, value]) => {
      rows.push({
        classId,
        subjectId,
        updatedAt: value?.updatedAt || null,
        hasHash: Boolean(value?.hash),
      });
    });
  });
  return rows;
};

export const verifyTeacherAccess = async (
  schoolId,
  enteredCode,
  codeType,
  classId,
  subjectId = null
) => {
  const record =
    codeType === "subject"
      ? await getSubjectTeacherCode(schoolId, classId, subjectId)
      : await getClassTeacherCode(schoolId, classId);

  if (!record?.hash) return null;

  const valid = await verifyPassword(enteredCode, record.hash);
  if (!valid) return null;

  return {
    verified: true,
    classId,
    subjectId: codeType === "subject" ? subjectId : undefined,
  };
};

export const deactivateCode = async () => {
  // Codes are now replaced in-place per class/subject key.
  return;
};

export default {
  generateAccessCode,
  hashAccessCode,
  verifyAccessCode,
  createClassAccessCode,
  createSubjectAccessCode,
  resetClassAccessCode,
  resetSubjectAccessCode,
  listClassAccessCodes,
  listSubjectAccessCodes,
  verifyTeacherAccess,
  deactivateCode,
};
