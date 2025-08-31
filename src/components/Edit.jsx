// src/components/EditUser.jsx
import React, { useState } from "react";
import Modal from "./Modal";

export default function EditUser({ user, onEdit, onClose }) {
  // Initialize state with current user info
  const [formData, setFormData] = useState({
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    email: user.email || "",
    age: user.age || "",
    phone: user.phone || "",
    company: user.company?.name || "",
    city: user.address?.city || "",
  });

  // Handle form changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle submit
  const handleSubmit = (e) => {
    e.preventDefault();
    // Call onEdit with updated info
    onEdit(formData);
    onClose(); // close modal after submit
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit User">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          type="text"
          name="firstName"
          placeholder="First Name"
          value={formData.firstName}
          onChange={handleChange}
          className="p-2 border rounded"
        />
        <input
          type="text"
          name="lastName"
          placeholder="Last Name"
          value={formData.lastName}
          onChange={handleChange}
          className="p-2 border rounded"
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          value={formData.email}
          onChange={handleChange}
          className="p-2 border rounded"
        />
        <input
          type="number"
          name="age"
          placeholder="Age"
          value={formData.age}
          onChange={handleChange}
          className="p-2 border rounded"
        />
        <input
          type="text"
          name="phone"
          placeholder="Phone"
          value={formData.phone}
          onChange={handleChange}
          className="p-2 border rounded"
        />
        <input
          type="text"
          name="company"
          placeholder="Company"
          value={formData.company}
          onChange={handleChange}
          className="p-2 border rounded"
        />
        <input
          type="text"
          name="city"
          placeholder="City"
          value={formData.city}
          onChange={handleChange}
          className="p-2 border rounded"
        />

        <div className="flex gap-2 mt-2">
          <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded">
            Submit
          </button>
        </div>
      </form>
    </Modal>
  );
}
