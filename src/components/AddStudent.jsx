import { useState, useEffect } from "react";

export default function AddStudent({
  isOpen,
  onClose,
  onAdd,
  onUpdate,
  editingStudent,
  isSubmitting = false,
}) {
  const [isLocalSubmitting, setIsLocalSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    regNumber: "",
    sex: "",
   
  });
  const busy = isSubmitting || isLocalSubmitting;

  useEffect(() => {
    if (!isOpen) return;

    if (editingStudent) {
      setForm({
        name: editingStudent.name || "",
        regNumber: editingStudent.regNumber || "",
        sex: editingStudent.sex || editingStudent.gender || "",
        
      });
      return;
    }

    setForm({
      name: "",
      regNumber: "",
      sex: "",
     
    });
  }, [editingStudent, isOpen]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;

    if (!form.name.trim()) {
      alert("Please enter student name");
      return;
    }

    setIsLocalSubmitting(true);
    try {
      if (editingStudent) {
        await Promise.resolve(onUpdate(form));
        return;
      }

      await Promise.resolve(onAdd(form));
    } finally {
      setIsLocalSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0  bg-black/40 backdrop-blur-sm  flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full mx-4 p-6 md:p-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-black dark:text-white">
            {editingStudent ? "Edit Student" : "Add Student"}
          </h2>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col">
            <label htmlFor="name" className="label-w mb-2">
              Student Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              placeholder="Enter full name"
              value={form.name}
              onChange={handleChange}
              className="input"
              required
              disabled={busy}
            />
          </div>

          <div className="flex flex-col">
            <label htmlFor="regNumber" className="label-w mb-2">
              Registration Number
            </label>
            <input
              type="text"
              id="regNumber"
              name="regNumber"
              placeholder="e.g., REG001"
              value={form.regNumber}
              onChange={handleChange}
              className="input"
              disabled={busy}
            />
          </div>

          <div className="flex flex-col">
            <label htmlFor="sex" className="label-w mb-2">
              Sex
            </label>
            <select
              id="sex"
              name="sex"
              value={form.sex || ""}
              onChange={handleChange}
              className="input"
              disabled={busy}
            >
              <option value="">Select Sex</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          </div>


          <div className="flex gap-3 mt-8">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2 px-4 rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 py-2 px-4 rounded-lg bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy
                ? (editingStudent ? "Updating..." : "Adding...")
                : `${editingStudent ? "Update" : "Add"} Student`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
