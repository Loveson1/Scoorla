import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  buildLegacySubjectAssignments,
  createTeacher,
  deleteTeacher,
  generateTeacherPin,
  generateTeacherStaffId,
  listTeachers,
  normalizeSubjectAssignments,
  resetTeacherPin,
  updateTeacher,
} from "../utils/teacherAuthService";

const roleOptions = [
  { value: "class_subject_teacher", label: "Class + Subject Teacher" },
  { value: "class_teacher", label: "Class Teacher" },
  { value: "subject_teacher", label: "Subject Teacher" },
];

const roleLabel = (role) =>
  roleOptions.find((item) => item.value === role)?.label || role || "Unknown";

const normalizeName = (value) => String(value || "").replace(/\s+/g, " ").trim();

const createEmptyForm = () => ({
  name: "",
  staffId: "",
  pin: "",
  role: "class_subject_teacher",
  classTeacherClasses: [],
  subjectAssignments: [],
});

const normalizeIdList = (values = []) =>
  [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];

const roleSupportsClassTeacher = (role) =>
  role === "class_teacher" || role === "class_subject_teacher";

const roleSupportsSubjectTeaching = (role) =>
  role === "subject_teacher" || role === "class_subject_teacher";

const countSubjectLinks = (subjectAssignments = []) =>
  normalizeSubjectAssignments(subjectAssignments).reduce(
    (total, assignment) => total + (assignment.classIds || []).length,
    0
  );

const buildTeacherFormAssignments = (teacher = {}) => {
  const structuredAssignments = normalizeSubjectAssignments(teacher?.subjectAssignments);
  if (structuredAssignments.length > 0) {
    return structuredAssignments;
  }
  return buildLegacySubjectAssignments({
    assignedClasses: teacher?.assignedClasses,
    assignedSubjects: teacher?.assignedSubjects,
  });
};

const normalizeFormSubjectAssignments = (items = []) => {
  if (!Array.isArray(items)) return [];

  const grouped = new Map();

  items.forEach((item) => {
    const subjectId =
      typeof item === "string"
        ? String(item || "").trim()
        : String(item?.subjectId || item?.subject || "").trim();
    if (!subjectId) return;

    const current = grouped.get(subjectId) || {
      subjectId,
      classIds: [],
    };

    const classIds = normalizeIdList(typeof item === "string" ? [] : item?.classIds || item?.classes);
    current.classIds = normalizeIdList([...(current.classIds || []), ...classIds]);
    grouped.set(subjectId, current);
  });

  return [...grouped.values()].sort((left, right) =>
    String(left.subjectId || "").localeCompare(String(right.subjectId || ""))
  );
};

export default function TeacherManagementPanel({ schoolId, classes = [], subjects = {} }) {
  const [teachers, setTeachers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTeacherId, setEditingTeacherId] = useState(null);
  const [error, setError] = useState("");
  const [generatedSecret, setGeneratedSecret] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [form, setForm] = useState(createEmptyForm());

  const classOptions = useMemo(
    () =>
      (classes || []).map((item) => ({
        id: String(item?.id || item || "").trim(),
        label: item?.label || item?.id || item,
      })),
    [classes]
  );
  const subjectOptions = useMemo(() => {
    const all = [...(subjects?.junior || []), ...(subjects?.senior || [])];
    return [...new Set(all.map((item) => String(item || "").trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [subjects]);

  const supportsClassTeacher = roleSupportsClassTeacher(form.role);
  const supportsSubjectTeaching = roleSupportsSubjectTeaching(form.role);

  const loadTeachers = useCallback(async () => {
    if (!schoolId) return;
    setIsLoading(true);
    setError("");
    try {
      const rows = await listTeachers(schoolId, { includeInactive: false });
      setTeachers(rows);
    } catch (loadError) {
      console.error("Error loading teachers:", loadError);
      setError(loadError?.message || "Failed to load teachers.");
    } finally {
      setIsLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadTeachers();
  }, [loadTeachers]);

  const resetForm = () => {
    setEditingTeacherId(null);
    setCopyFeedback("");
    setForm(createEmptyForm());
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const toggleClassTeacherClass = (classId) => {
    const normalizedClassId = String(classId || "").trim();
    if (!normalizedClassId) return;
    setForm((prev) => {
      const current = normalizeIdList(prev.classTeacherClasses);
      const exists = current.includes(normalizedClassId);
      return {
        ...prev,
        classTeacherClasses: exists
          ? current.filter((item) => item !== normalizedClassId)
          : [...current, normalizedClassId],
      };
    });
  };

  const toggleSubjectSelection = (subjectId) => {
    const normalizedSubjectId = String(subjectId || "").trim();
    if (!normalizedSubjectId) return;
    setForm((prev) => {
      const current = normalizeFormSubjectAssignments(prev.subjectAssignments);
      const exists = current.some((item) => item.subjectId === normalizedSubjectId);
      return {
        ...prev,
        subjectAssignments: exists
          ? current.filter((item) => item.subjectId !== normalizedSubjectId)
          : [...current, { subjectId: normalizedSubjectId, classIds: [] }],
      };
    });
  };

  const toggleSubjectClass = (subjectId, classId) => {
    const normalizedSubjectId = String(subjectId || "").trim();
    const normalizedClassId = String(classId || "").trim();
    if (!normalizedSubjectId || !normalizedClassId) return;

    setForm((prev) => {
      const current = normalizeFormSubjectAssignments(prev.subjectAssignments);
      const nextAssignments = current.map((assignment) => {
        if (assignment.subjectId !== normalizedSubjectId) {
          return assignment;
        }
        const classIds = normalizeIdList(assignment.classIds);
        const exists = classIds.includes(normalizedClassId);
        return {
          ...assignment,
          classIds: exists
            ? classIds.filter((item) => item !== normalizedClassId)
            : [...classIds, normalizedClassId],
        };
      });

      return {
        ...prev,
        subjectAssignments: nextAssignments,
      };
    });
  };

  const validateForm = () => {
    const name = normalizeName(form.name);
    if (!name) {
      return "Teacher name is required.";
    }

    if (supportsClassTeacher && normalizeIdList(form.classTeacherClasses).length === 0) {
      return "Select at least one class the teacher manages as class teacher.";
    }

    if (supportsSubjectTeaching) {
      const normalizedAssignments = normalizeSubjectAssignments(form.subjectAssignments);
      if (normalizedAssignments.length === 0) {
        return "Select at least one subject and assign classes for it.";
      }
      const incompleteAssignment = normalizedAssignments.find(
        (assignment) => normalizeIdList(assignment.classIds).length === 0
      );
      if (incompleteAssignment) {
        return `Assign at least one class for ${incompleteAssignment.subjectId}.`;
      }
    }

    return "";
  };

  const handleCreateOrUpdate = async () => {
    if (!schoolId) return;
    const name = normalizeName(form.name);
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const classTeacherClasses = supportsClassTeacher
      ? normalizeIdList(form.classTeacherClasses)
      : [];
    const subjectAssignments = supportsSubjectTeaching
      ? normalizeSubjectAssignments(form.subjectAssignments)
      : [];

    setIsSubmitting(true);
    setError("");
    setGeneratedSecret(null);
    setCopyFeedback("");
    try {
      if (editingTeacherId) {
        await updateTeacher({
          schoolId,
          teacherUserId: editingTeacherId,
          name,
          role: form.role,
          classTeacherClasses,
          subjectAssignments,
          isActive: true,
        });
      } else {
        const result = await createTeacher({
          schoolId,
          name,
          staffId: form.staffId || generateTeacherStaffId(),
          pin: form.pin || generateTeacherPin(),
          role: form.role,
          classTeacherClasses,
          subjectAssignments,
        });
        setGeneratedSecret({
          schoolId: result.schoolId || schoolId,
          staffId: result.staffId,
          pin: result.pin,
        });
      }

      await loadTeachers();
      resetForm();
    } catch (submitError) {
      console.error("Error saving teacher:", submitError);
      setError(submitError?.message || "Failed to save teacher.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (teacher) => {
    setEditingTeacherId(teacher.id);
    setGeneratedSecret(null);
    setError("");
    setCopyFeedback("");
    setForm({
      name: teacher.name || "",
      staffId: teacher.staffId || "",
      pin: "",
      role: teacher.role || "class_subject_teacher",
      classTeacherClasses: normalizeIdList(teacher.classTeacherClasses),
      subjectAssignments: buildTeacherFormAssignments(teacher),
    });
  };

  const handleDelete = async (teacher) => {
    if (!teacher?.id || !schoolId) return;
    if (!window.confirm(`Delete teacher ${teacher.name || teacher.staffId}?`)) return;

    setIsSubmitting(true);
    setError("");
    setGeneratedSecret(null);
    setCopyFeedback("");
    try {
      await deleteTeacher({
        schoolId,
        teacherUserId: teacher.id,
      });
      await loadTeachers();
      if (editingTeacherId === teacher.id) resetForm();
    } catch (deleteError) {
      console.error("Error deleting teacher:", deleteError);
      setError(deleteError?.message || "Failed to delete teacher.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPin = async (teacher) => {
    if (!teacher?.id || !schoolId) return;
    if (!window.confirm(`Reset PIN for ${teacher.name || teacher.staffId}?`)) return;

    setIsSubmitting(true);
    setError("");
    setGeneratedSecret(null);
    setCopyFeedback("");
    try {
      const result = await resetTeacherPin({
        schoolId,
        teacherUserId: teacher.id,
      });
      setGeneratedSecret({
        schoolId: result.schoolId || schoolId,
        staffId: teacher.staffId,
        pin: result.pin,
      });
      await loadTeachers();
      if (editingTeacherId === teacher.id) {
        resetForm();
      }
    } catch (resetError) {
      console.error("Error resetting teacher PIN:", resetError);
      setError(resetError?.message || "Failed to reset PIN.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyCredentials = async () => {
    if (!generatedSecret) return;
    const payload = [
      `School ID: ${generatedSecret.schoolId || schoolId || ""}`,
      `Staff ID: ${generatedSecret.staffId || ""}`,
      `PIN: ${generatedSecret.pin || ""}`,
    ].join("\n");

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = payload;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyFeedback("Credentials copied.");
    } catch {
      setCopyFeedback("Could not copy automatically. Copy manually.");
    }
  };

  const selectedSubjectAssignments = normalizeFormSubjectAssignments(form.subjectAssignments);

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-2xl font-semibold text-black dark:text-white mb-2">Teacher Management</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Create teachers, define class-teacher access separately from subject teaching access, reset PINs, and deactivate teacher accounts.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {generatedSecret && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300">
          <p className="font-semibold">Teacher credentials generated</p>
          <p>School ID: {generatedSecret.schoolId || schoolId}</p>
          <p>Staff ID: {generatedSecret.staffId}</p>
          <p>PIN: {generatedSecret.pin}</p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopyCredentials}
              className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-800 dark:bg-green-600 dark:hover:bg-green-500"
            >
              Copy Credentials
            </button>
            {copyFeedback ? <span className="text-xs font-medium">{copyFeedback}</span> : null}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
        <h4 className="mb-4 text-lg font-semibold text-black dark:text-white">
          {editingTeacherId ? "Edit Teacher" : "Create Teacher"}
        </h4>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label-w mb-2 block">Teacher Name</label>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              className="input w-full"
              placeholder="Teacher name"
            />
          </div>

          <div>
            <label className="label-w mb-2 block">Role</label>
            <select
              name="role"
              value={form.role}
              onChange={handleChange}
              className="input w-full"
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-w mb-2 block">Staff ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                name="staffId"
                value={form.staffId}
                onChange={handleChange}
                disabled={!!editingTeacherId}
                className="input w-full disabled:opacity-70"
                placeholder="STF-0001"
              />
              {!editingTeacherId && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, staffId: generateTeacherStaffId() }))}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Auto
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="label-w mb-2 block">PIN</label>
            <div className="flex gap-2">
              <input
                type="text"
                name="pin"
                value={form.pin}
                onChange={handleChange}
                disabled={!!editingTeacherId}
                className="input w-full disabled:opacity-70"
                placeholder={editingTeacherId ? "Use Reset PIN action" : "4-digit PIN"}
                maxLength={4}
              />
              {!editingTeacherId && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, pin: generateTeacherPin() }))}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Auto
                </button>
              )}
            </div>
          </div>
        </div>

        {supportsClassTeacher && (
          <div className="mt-5">
            <p className="label-w mb-2 block">Class Teacher Classes</p>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              These are the classes this teacher can manage as class teacher on the class dashboard.
            </p>
            <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              {classOptions.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">No classes configured.</p>
              )}
              {classOptions.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={normalizeIdList(form.classTeacherClasses).includes(String(item.id))}
                    onChange={() => toggleClassTeacherClass(item.id)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {supportsSubjectTeaching && (
          <div className="mt-5 space-y-4">
            <div>
              <p className="label-w mb-2 block">Subjects Taught</p>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                Select each subject, then choose the classes the teacher handles for that subject.
              </p>
              <div className="max-h-48 space-y-2 overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                {subjectOptions.length === 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">No subjects configured.</p>
                )}
                {subjectOptions.map((subject) => {
                  const isSelected = selectedSubjectAssignments.some(
                    (assignment) => assignment.subjectId === String(subject)
                  );
                  return (
                    <label key={subject} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSubjectSelection(subject)}
                      />
                      <span>{subject}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {selectedSubjectAssignments.length > 0 && (
              <div className="space-y-3">
                {selectedSubjectAssignments.map((assignment) => (
                  <div
                    key={assignment.subjectId}
                    className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-black dark:text-white">{assignment.subjectId}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Choose the classes this teacher records {assignment.subjectId} for.
                        </p>
                      </div>
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                        {(assignment.classIds || []).length} class{(assignment.classIds || []).length === 1 ? "" : "es"}
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {classOptions.map((item) => (
                        <label
                          key={`${assignment.subjectId}__${item.id}`}
                          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200"
                        >
                          <input
                            type="checkbox"
                            checked={normalizeIdList(assignment.classIds).includes(String(item.id))}
                            onChange={() => toggleSubjectClass(assignment.subjectId, item.id)}
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCreateOrUpdate}
            disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-800 px-5 py-2 font-semibold text-white hover:bg-blue-900 disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting
              ? (editingTeacherId ? "Updating Teacher..." : "Creating Teacher...")
              : (editingTeacherId ? "Update Teacher" : "Create Teacher")}
          </button>
          {editingTeacherId && (
            <button
              type="button"
              onClick={resetForm}
              disabled={isSubmitting}
              className="rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Cancel Edit
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-700">
        <h4 className="mb-4 text-lg font-semibold text-black dark:text-white">Teachers</h4>
        {isLoading ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading teachers...</p>
        ) : teachers.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">No teachers created yet.</p>
        ) : (
          <div className="space-y-3">
            {teachers.map((teacher) => {
              const teacherSubjectAssignments = buildTeacherFormAssignments(teacher);
              return (
                <div
                  key={teacher.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div>
                    <p className="text-sm font-semibold text-black dark:text-white">
                      {teacher.name || "Unnamed"} ({teacher.staffId || "No Staff ID"})
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{roleLabel(teacher.role)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Class Teacher Classes: {normalizeIdList(teacher.classTeacherClasses).length} | Subject Assignments: {teacherSubjectAssignments.length} subject{teacherSubjectAssignments.length === 1 ? "" : "s"} across {countSubjectLinks(teacherSubjectAssignments)} class link{countSubjectLinks(teacherSubjectAssignments) === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(teacher)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResetPin(teacher)}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                    >
                      Reset PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(teacher)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

