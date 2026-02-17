import PasswordModal from "./PasswordModal";
import {
  getClassTeacherCode,
  getSubjectTeacherCode,
} from "../utils/firebaseDatabase";
import { verifyPassword } from "../utils/passwordUtils";

/**
 * Wrapper modal for teacher access verification.
 * Keeps existing component contract while using the reusable PasswordModal.
 */
export default function TeacherPasswordModal({
  isOpen,
  onClose,
  onVerified,
  accessType,
  schoolId,
  classId,
  subjectId,
  itemName,
}) {
  const handleVerify = async (inputPassword) => {
    try {
      if (!schoolId || !classId) {
        return { ok: false, error: "Missing school or class context." };
      }

      let record = null;
      if (accessType === "subject") {
        if (!subjectId) {
          return { ok: false, error: "Missing subject context." };
        }
        record = await getSubjectTeacherCode(schoolId, classId, subjectId);
      } else {
        record = await getClassTeacherCode(schoolId, classId);
      }

      if (!record?.hash) {
        return {
          ok: false,
          error:
            "Password has not been configured yet. Please contact your admin.",
        };
      }

      const isValid = await verifyPassword(inputPassword, record.hash);
      if (!isValid) {
        return { ok: false, error: "Invalid password. Please try again." };
      }

      onVerified?.({
        verified: true,
        classId,
        subjectId: accessType === "subject" ? subjectId : undefined,
      });

      return { ok: true };
    } catch {
      return {
        ok: false,
        error: "Unable to verify password right now. Check your connection.",
      };
    }
  };

  return (
    <PasswordModal
      isOpen={isOpen}
      onClose={onClose}
      title="Enter Password"
      description={`${
        accessType === "subject" ? "Subject" : "Class"
      }: ${itemName || ""}`}
      onSubmit={handleVerify}
    />
  );
}
