// src/components/Users.jsx
import React, { useEffect, useState } from "react";
import Modal from "../components/Modal";
import AddUser from "./AddUser";
import Edit from "./Edit";
import axiosClient from "../api/axiosClient";
import { useQuery } from "@tanstack/react-query";

//  UserCard shows minimal info + action buttons
function UserCard({ user, onView, onEdit, setDeleteUser }) {
  // <-- add onEdit prop
  const { firstName, lastName, email } = user;

  return (
    <article className="border rounded-lg p-4 mb-4 shadow-md bg-white dark:bg-gray-800 dark:text-gray-100">
      <h3 className="text-lg font-semibold">
        {firstName} {lastName}
      </h3>
      <p>
        <strong>Email:</strong> {email}
      </p>
      <p className="text-sm text-gray-500 dark:text-gray-400 italic">
        Click View to see more details
      </p>

      <div className="flex gap-2 mt-10">
        <button
          className="px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
          onClick={() => onView(user)}
        >
          View
        </button>
        <button
          className="px-3 py-1 rounded bg-green-500 text-white hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-700"
          onClick={() => onEdit(user)} // <-- call the handler passed as prop
        >
          Edit
        </button>
        <button
          className="px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700"
          onClick={() => setDeleteUser(user)} // open modal
        >
          Delete
        </button>
      </div>
    </article>
  );
}

export default function Users() {
  // Manage which user is being viewed in modal
  const [selectedUser, setSelectedUser] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  // local users array + setter
  const [users, setUsers] = useState([]);
  // Track which user we want to delete
  const [deleteUser, setDeleteUser] = useState(null);
  // state for edit modal
  const [editUser, setEditUser] = useState(null);
  // Handle adding new user
  const [searchTerm, setSearchTerm] = useState("");
  const handleAddUser = (newUser) => {
    // Create a new card with same structure as API cards
    const formattedUser = {
      id: users.length + 1000, // fake ID so it’s unique
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      email: newUser.email,
      age: newUser.age,
      phone: newUser.phone,
      company: { name: newUser.company },
      address: { city: newUser.city },
    };

    setUsers((prev) => [...prev, formattedUser]);
  };

  // Handles deleting a user by filtering them out of the users array
  const handleDeleteUser = (userId) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  //  handler to update user in users array
  const handleEditUser = (updatedUser) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === editUser.id
          ? {
              ...u,
              firstName: updatedUser.firstName,
              lastName: updatedUser.lastName,
              email: updatedUser.email,
              age: updatedUser.age,
              phone: updatedUser.phone,
              company: { name: updatedUser.company },
              address: { city: updatedUser.city },
            }
          : u
      )
    );
  };
  // Fetch users with React Query
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await axiosClient.get("/users");
      return res.data.users.slice(0, 3);
    },
    staleTime: 1000 * 60 * 5,
  });

  // Initialize users state when API data is ready
  useEffect(() => {
    if (data && users.length === 0) {
      setUsers(Array.isArray(data) ? data : []);
    }
  }, [data]);

  if (isLoading)
    return <p className="  dark:text-white text-center ">Loading users…</p>;
  if (isError)
    return (
      <p className="  dark:text-white text-center ">
        Error: {error?.message ?? "Unknown error"}
      </p>
    );
  if (!users.length) return <p>No users found</p>;

  const filteredUsers = users.filter(
    (u) =>
      u.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <section className="p-6  h-lvh ">
      <div className="flex justify-between items-center gap-1  mb-15">
        {/* Global Add User button */}
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700"
        >
          + Add User
        </button>

        {/* Show AddUser modal when button clicked */}
        {showAddModal && (
          <AddUser
            onAdd={handleAddUser}
            onClose={() => setShowAddModal(false)}
          />
        )}

        <input
          type="text"
          placeholder="Search users..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className=" p-2 border rounded w-auto dark:bg-gray-700 dark:text-white"
        />
      </div>
      <h2 className="text-3xl font-bold py-4 dark:text-white">List of Users</h2>
      {/* User cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 ">
        {filteredUsers.map((u) => (
          <UserCard
            key={u.id}
            user={u}
            onView={(user) => setSelectedUser(user)}
            onEdit={(user) => setEditUser(user)}
            setDeleteUser={setDeleteUser}
          />
        ))}
      </div>

      {deleteUser && (
        <Modal
          isOpen={!!deleteUser}
          onClose={() => setDeleteUser(null)}
          title="Confirm Delete"
        >
          <p>
            Are you sure you want to delete{" "}
            <strong>
              {deleteUser.firstName} {deleteUser.lastName}
            </strong>
            ?
          </p>
          <div className="flex gap-4 mt-4">
            <button
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              onClick={() => {
                handleDeleteUser(deleteUser.id); // delete user
                setDeleteUser(null); // close modal
              }}
            >
              Yes
            </button>
            <button
              className="px-4 py-2 bg-gray-300 text-black rounded hover:bg-gray-400"
              onClick={() => setDeleteUser(null)} // cancel
            >
              No
            </button>
          </div>
        </Modal>
      )}
      {editUser && (
        <Edit
          user={editUser}
          onEdit={(updatedUser) => {
            handleEditUser(updatedUser); // updates the users array
            setEditUser(null); // closes the modal
          }}
          onClose={() => setEditUser(null)}
        />
      )}

      {/* Modal for viewing user details */}
      <Modal
        isOpen={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        title="User Details"
      >
        {selectedUser && (
          <div>
            <p>
              <strong>Name:</strong> {selectedUser.firstName}{" "}
              {selectedUser.lastName}
            </p>
            <p>
              <strong>Email:</strong> {selectedUser.email}
            </p>
            <p>
              <strong>Age:</strong> {selectedUser.age}
            </p>
            <p>
              <strong>Phone:</strong> {selectedUser.phone}
            </p>
            <p>
              <strong>Company:</strong> {selectedUser.company?.name ?? "—"}
            </p>
            <p>
              <strong>City:</strong> {selectedUser.address?.city ?? "—"}
            </p>
          </div>
        )}
      </Modal>
    </section>
  );
}
