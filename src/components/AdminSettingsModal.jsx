import { useState } from "react";
import { getAdminSettings, saveAdminSettings } from "./utils/school-data";

export default function AdminSettingsModal({ isOpen, onClose }) {
  const [activeMenu, setActiveMenu] = useState(null);

  const menuItems = [
    {
      id: "edit-school",
      label: "Edit School Details",
      icon: "✏️",
      description: "Update school information",
    },
    {
      id: "manage-class",
      label: "Manage Classes",
      icon: "📚",
      description: "Add or manage classes",
    },
    {
      id: "manage-subject",
      label: "Manage Subjects",
      icon: "📖",
      description: "Add or manage subjects",
    },
    {
      id: "result-settings",
      label: "Result Settings",
      icon: "⚙️",
      description: "Configure grading and result settings",
    },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full mx-4 p-6 md:p-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-black dark:text-white">
            Admin Settings
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-3xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Menu Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveMenu(item.id)}
              className={`p-6 rounded-lg border-2 transition-all duration-300 text-left ${
                activeMenu === item.id
                  ? "border-blue-800 bg-blue-50 dark:bg-gray-700 dark:border-blue-500"
                  : "border-gray-300 dark:border-gray-600 hover:border-blue-800 dark:hover:border-blue-500"
              }`}
            >
              <div className="text-4xl mb-3">{item.icon}</div>
              <h3 className="text-lg font-bold text-black dark:text-white mb-2">
                {item.label}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {item.description}
              </p>
            </button>
          ))}
        </div>

        {/* Content Section */}
        {activeMenu && (
          <div className="bg-gray-50 dark:bg-gray-700 p-6 rounded-lg mb-8">
            {activeMenu === "edit-school" && (
              <EditSchoolDetails onClose={onClose} />
            )}
            {activeMenu === "manage-class" && (
              <ManageClasses onClose={onClose} />
            )}
            {activeMenu === "manage-subject" && (
              <ManageSubjects onClose={onClose} />
            )}
            {activeMenu === "result-settings" && (
              <ResultSettings onClose={onClose} />
            )}
          </div>
        )}

        {/* Footer Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg border-2 border-gray-300 dark:border-gray-600 text-black dark:text-white font-semibold hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function EditSchoolDetails() {
  return (
    <div>
      <h3 className="text-xl font-bold text-black dark:text-white mb-4">
        Edit School Details
      </h3>
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        Update your school information including name, address, email, and phone
        number.
      </p>
      <button className="px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300">
        Go to Edit School
      </button>
    </div>
  );
}

function ManageClasses() {
  return (
    <div>
      <h3 className="text-xl font-bold text-black dark:text-white mb-4">
        Manage Classes
      </h3>
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        Add new classes or manage existing classes. Currently supports JSS and SSS
        levels.
      </p>
      <div className="mb-4 p-3 bg-white dark:bg-gray-600 rounded border border-gray-300 dark:border-gray-500">
        <p className="text-sm font-semibold text-black dark:text-white mb-2">
          Available Classes:
        </p>
        <div className="grid grid-cols-3 gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span>• JSS 1</span>
          <span>• JSS 2</span>
          <span>• JSS 3</span>
          <span>• SSS 1</span>
          <span>• SSS 2</span>
          <span>• SSS 3</span>
        </div>
      </div>
      <button className="px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300">
        Manage Classes
      </button>
    </div>
  );
}

function ManageSubjects() {
  return (
    <div>
      <h3 className="text-xl font-bold text-black dark:text-white mb-4">
        Manage Subjects
      </h3>
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        Add or remove subjects for Junior and Senior classes. Subjects are
        automatically determined by class level.
      </p>
      <div className="space-y-3 mb-4">
        <div className="p-3 bg-white dark:bg-gray-600 rounded border border-gray-300 dark:border-gray-500">
          <p className="text-sm font-semibold text-black dark:text-white mb-2">
            Junior School Subjects (JSS 1-3):
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            Business Studies, Civic Education, Social Studies, Christian Religious
            Knowledge/Islamic Studies, English Language, Mathematics, Basic Science
            and Technology, Agricultural Science, Home Economics, Cultural and
            Creative Arts
          </p>
        </div>
        <div className="p-3 bg-white dark:bg-gray-600 rounded border border-gray-300 dark:border-gray-500">
          <p className="text-sm font-semibold text-black dark:text-white mb-2">
            Senior School Subjects (SSS 1-3):
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            English Language, Mathematics, Biology, Further Mathematics, Economics,
            Literature, Computer Studies, C.R. Studies, Government/History,
            Geography, French, Fine Arts, Music, Agricultural Science, Commerce,
            Physics, Chemistry, Financial Accounting
          </p>
        </div>
      </div>
      <button className="px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300">
        Manage Subjects
      </button>
    </div>
  );
}

function ResultSettings() {
  const [adminSettings, setAdminSettings] = useState(getAdminSettings());
  const [isSaving, setIsSaving] = useState(false);

  const handleDateChange = (e) => {
    setAdminSettings({
      ...adminSettings,
      nextTermBegins: e.target.value,
    });
  };

  const handleSave = () => {
    setIsSaving(true);
    saveAdminSettings(adminSettings);
    setTimeout(() => {
      setIsSaving(false);
      alert("Settings saved successfully!");
    }, 500);
  };

  return (
    <div>
      <h3 className="text-xl font-bold text-black dark:text-white mb-4">
        Result Settings
      </h3>
      <p className="text-gray-600 dark:text-gray-400 mb-4">
        Configure grading scale and result calculation settings.
      </p>

      {/* Next Term Begins Setting */}
      <div className="p-4 bg-white dark:bg-gray-600 rounded border border-gray-300 dark:border-gray-500 mb-4">
        <p className="text-sm font-semibold text-black dark:text-white mb-3">
          Next Term Begins:
        </p>
        <input
          type="date"
          value={adminSettings.nextTermBegins}
          onChange={handleDateChange}
          className="input w-full md:w-48"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          This date will appear on student result sheets
        </p>
      </div>

      {/* Grading Scale */}
      <div className="p-4 bg-white dark:bg-gray-600 rounded border border-gray-300 dark:border-gray-500 mb-4">
        <p className="text-sm font-semibold text-black dark:text-white mb-3">
          Default Grading Scale:
        </p>
        <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
          <p>
            <span className="font-semibold text-black dark:text-white">A:</span>{" "}
            70 - 100
          </p>
          <p>
            <span className="font-semibold text-black dark:text-white">B:</span>{" "}
            55 - 69
          </p>
          <p>
            <span className="font-semibold text-black dark:text-white">C:</span>{" "}
            50 - 54
          </p>
          <p>
            <span className="font-semibold text-black dark:text-white">D:</span>{" "}
            45 - 49
          </p>
          <p>
            <span className="font-semibold text-black dark:text-white">E:</span>{" "}
            40 - 44
          </p>
          <p>
            <span className="font-semibold text-black dark:text-white">F:</span>{" "}
            0 - 39
          </p>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="px-6 py-2 bg-blue-800 hover:bg-blue-900 dark:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold rounded-lg transition-all duration-300 disabled:opacity-50"
      >
        {isSaving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}
