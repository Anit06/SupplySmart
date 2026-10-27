import { useEffect, useState } from "react";
import { FaEdit, FaTrash } from "react-icons/fa";
import Sidebar from "../components/common/Sidebar";
import "../assets/css/users.css";
import {
  getUsers,
  updateRole,
  deleteUser
} from "../services/authService";

function Users() {
  const [users, setUsers] = useState([]);
  const [editUserId, setEditUserId] = useState(null);
  const [editData, setEditData] = useState({
    name: "",
    email: "",
    phone: "",
    role: ""
  });

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 10;

  const currentRole = localStorage.getItem("role");

  const loadUsers = async () => {
    try {
      const data = await getUsers();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    let active = true;
    getUsers()
      .then((data) => {
        if (active && data.success) setUsers(data.users);
      })
      .catch((error) => console.log(error));

    return () => {
      active = false;
    };
  }, []);

  // Pagination Calculations
  const indexOfLastUser = currentPage * usersPerPage;
  const indexOfFirstUser = indexOfLastUser - usersPerPage;
  const currentUsers = users.slice(indexOfFirstUser, indexOfLastUser);
  const totalPages = Math.ceil(users.length / usersPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const handleEdit = (user) => {
    setEditUserId(user._id);
    setEditData({
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role
    });
  };

  const handleUpdate = async () => {
    try {
      const response = await updateRole(editUserId, editData);

      if (response.success) {
        alert("User Updated Successfully");
        setEditUserId(null);
        loadUsers();
      }
    } catch (error) {
      console.log(error);
      alert("Update Failed");
    }
  };

  const handleCancel = () => {
    setEditUserId(null);
    setEditData({
      name: "",
      email: "",
      phone: "",
      role: ""
    });
  };

  const handleDelete = async (userId) => {
    if (!window.confirm("Delete this user?")) return;

    try {
      const response = await deleteUser(userId);

      if (response.success) {
        alert("User Deleted Successfully");
        await loadUsers();
        // Reset to previous page if current page becomes empty after deletion
        if (currentUsers.length === 1 && currentPage > 1) {
          setCurrentPage((prev) => prev - 1);
        }
        return;
      }

      alert(response.message || "Delete Failed");
    } catch (error) {
      console.log(error);
      alert("Delete Failed");
    }
  };

  return (
    <div className="users-layout">
      {/* Sidebar */}
      <Sidebar />

      {/* Content */}
      <div className="users-content">
        <h1>User Management</h1>

        <table className="users-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Created Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {currentUsers.length > 0 ? (
              currentUsers.map((user) => (
                <tr key={user._id}>
                  {/* Name */}
                  <td>
                    {editUserId === user._id ? (
                      <input
                        type="text"
                        value={editData.name}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            name: e.target.value
                          })
                        }
                      />
                    ) : (
                      user.name
                    )}
                  </td>

                  {/* Email */}
                  <td>
                    {editUserId === user._id ? (
                      <input
                        type="email"
                        value={editData.email}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            email: e.target.value
                          })
                        }
                      />
                    ) : (
                      user.email
                    )}
                  </td>

                  {/* Phone */}
                  <td>
                    {editUserId === user._id ? (
                      <input
                        type="text"
                        value={editData.phone}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            phone: e.target.value
                          })
                        }
                      />
                    ) : (
                      user.phone
                    )}
                  </td>

                  {/* Role */}
                  <td>
                    {editUserId === user._id ? (
                      <select
                        value={editData.role}
                        onChange={(e) =>
                          setEditData({
                            ...editData,
                            role: e.target.value
                          })
                        }
                        disabled={currentRole !== "admin"}
                      >
                        <option value="user">User</option>
                        <option value="administrative_user">
                          Administrative User
                        </option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      user.role
                    )}
                  </td>

                  {/* Created Date */}
                  <td>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>

                  {/* Action */}
                 <td className="action-column">
  {editUserId === user._id ? (
    <div className="action-buttons">
      <button
        className="update-btn"
        onClick={handleUpdate}
      >
        Update
      </button>

      <button
        className="cancel-btn"
        onClick={handleCancel}
      >
        Cancel
      </button>
    </div>
  ) : (
    <div className="action-buttons">
      <button
        className="edit-btn"
        title="Edit"
        onClick={() => handleEdit(user)}
      >
        <FaEdit />
      </button>

      <button
        className="delete-btn"
        title="Delete"
        onClick={() => handleDelete(user._id)}
      >
        <FaTrash />
      </button>
    </div>
  )}
</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className="no-users">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="pagination">
            <button
              className="page-btn"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              Previous
            </button>

            {Array.from({ length: totalPages }, (_, index) => index + 1).map(
              (page) => (
                <button
                  key={page}
                  className={`page-btn ${currentPage === page ? "active" : ""
                    }`}
                  onClick={() => handlePageChange(page)}
                >
                  {page}
                </button>
              )
            )}

            <button
              className="page-btn"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Users;