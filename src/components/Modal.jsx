function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null; 

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-lg w-96 p-6">
        <h3 className="text-xl font-bold mb-4 dark:text-gray-100">{title}</h3>

        <div className="dark:text-gray-200">{children}</div>

        {/* Back button */}
        <div className="mt-6 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
 export default Modal