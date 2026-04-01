import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createTeacher,
  deleteTeacher,
  generateTeacherPin,
  generateTeacherStaffId,
  listTeachers,
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

const collapseAssignedSubjectsForForm = (values = [], subjectOptions = []) => {
  const normalizedValues = [...new Set(
    (values || []).map((item) => String(item || "").trim()).filter(Boolean)
  )];
  const availableSubjects = new Set(
    (subjectOptions || []).map((item) => String(item || "").trim()).filter(Boolean)
  );
  const hasBasicScienceAlias = normalizedValues.some((item) => {
    const token = item.toLowerCase();
    return (
      token === "basic science" ||
      token === "basic science and technology" ||
      token === "basic science & technology"
    );
  });

  const filtered = normalizedValues.filter((item) => {
    const token = item.toLowerCase();
    return (
      token !== "basic science" &&
      token !== "basic science and technology" &&
      token !== "basic science & technology"
    );
  });

  if (hasBasicScienceAlias) {
    if (availableSubjects.has("Basic Science and Technology")) {
      filtered.push("Basic Science and Technology");
    } else if (availableSubjects.has("Basic Science")) {
      filtered.push("Basic Science");
    } else {
      filtered.push("Basic Science and Technology");
    }
  }

  return [...new Set(filtered)];
};

export default function TeacherManagementPanel({ schoolId, classes = [], subjects = {} }) {
  const [teachers, setTeachers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTeacherId, setEditingTeacherId] = useState(null);
  const [error, setError] = useState("");
  const [generatedSecret, setGeneratedSecret] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const [form, setForm] = useState({
    name: "",
    staffId: "",
    pin: "",
    role: "class_subject_teacher",
    assignedClasses: [],
    assignedSubjects: [],
  });

  const classOptions = useMemo(
    () => (classes || []).map((item) => ({ id: item.id || item, label: item.label || item.id || item })),
    [classes]
  );
  const subjectOptions = useMemo(() => {
    const all = [...(subjects?.junior || []), ...(subjects?.senior || [])];
    return [...new Set(all.map((item) => String(item || "").trim()).filter(Boolean))];
  }, [subjects]);

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
    setForm({
      name: "",
      staffId: "",
      pin: "",
      role: "class_subject_teacher",
      assignedClasses: [],
      assignedSubjects: [],
    });
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const toggleMultiValue = (field, value) => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    setForm((prev) => {
      const current = Array.isArray(prev[field]) ? prev[field] : [];
      const exists = current.includes(normalized);
      return {
        ...prev,
        [field]: exists ? current.filter((item) => item !== normalized) : [...current, normalized],
      };
    });
  };

  const handleCreateOrUpdate = async () => {
    if (!schoolId) return;
    const name = normalizeName(form.name);
    if (!name) {
      setError("Teacher name is required.");
      return;
    }

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
          assignedClasses: form.assignedClasses,
          assignedSubjects: form.assignedSubjects,
          isActive: true,
        });
      } else {
        const result = await createTeacher({
          schoolId,
          name,
          staffId: form.staffId || generateTeacherStaffId(),
          pin: form.pin || generateTeacherPin(),
          role: form.role,
          assignedClasses: form.assignedClasses,
          assignedSubjects: form.assignedSubjects,
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
      assignedClasses: Array.isArray(teacher.assignedClasses) ? teacher.assignedClasses : [],
      assignedSubjects: collapseAssignedSubjectsForForm(teacher.assignedSubjects, subjectOptions),
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

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-2xl font-semibold text-black dark:text-white mb-2">Teacher Management</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Create teachers, assign classes/subjects, reset PINs, and deactivate teacher access.
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

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="label-w mb-2 block">Assign Classes</p>
            <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              {classOptions.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">No classes configured.</p>
              )}
              {classOptions.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={form.assignedClasses.includes(String(item.id))}
                    onChange={() => toggleMultiValue("assignedClasses", item.id)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="label-w mb-2 block">Assign Subjects</p>
            <div className="max-h-40 space-y-2 overflow-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              {subjectOptions.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">No subjects configured.</p>
              )}
              {subjectOptions.map((subject) => (
                <label key={subject} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    checked={form.assignedSubjects.includes(String(subject))}
                    onChange={() => toggleMultiValue("assignedSubjects", subject)}
                  />
                  <span>{subject}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCreateOrUpdate}
            disabled={isSubmitting}
            className="rounded-lg bg-blue-800 px-5 py-2 font-semibold text-white hover:bg-blue-900 disabled:opacity-60 dark:bg-blue-700 dark:hover:bg-blue-600"
          >
            {editingTeacherId ? "Update Teacher" : "Create Teacher"}
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
            {teachers.map((teacher) => (
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
                    Classes: {(teacher.assignedClasses || []).length} | Subjects: {collapseAssignedSubjectsForForm(teacher.assignedSubjects, subjectOptions).length}
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
