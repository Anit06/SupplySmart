import { useState, useEffect } from "react";
import Sidebar from "../../common/Sidebar";
import "../../../assets/css/supplier.css";
import {  FaEdit, FaTrash } from "react-icons/fa";
import {
  getSuppliers,
  addSupplier,
  updateSupplier,
  deleteSupplier,
} from "../../../services/supplierService";


function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [capacityFilter, setCapacityFilter] = useState("All");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    supplierCode: "",
    supplierName: "",
    supplierPhonenumber: "",
    supplierAddress: "",
    supplierVehiclenumber: "",
    supplierCapacity: "",
  });

  const [editId, setEditId] = useState(null);

  const loadSuppliers = async () => {
    try {
      const data = await getSuppliers();

      if (data.success) {
        setSuppliers(data.supplier);
      }
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    let active = true;
    getSuppliers()
      .then((data) => {
        if (active && data.success) {
          setSuppliers(data.supplier);
        }
      })
      .catch((error) => console.log(error));

    return () => {
      active = false;
    };
  }, []);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      let response;

      if (editId) {
        response = await updateSupplier(editId, formData);
      } else {
        response = await addSupplier(formData);
      }

      if (response.success) {
        alert(
          editId
            ? "Supplier Updated Successfully"
            : "Supplier Added Successfully"
        );

        setFormData({
          supplierCode: "",
          supplierName: "",
          supplierPhonenumber: "",
          supplierAddress: "",
          supplierVehiclenumber: "",
          supplierCapacity: "",
        });

        setEditId(null);

        loadSuppliers();
      }
    } catch (error) {
      console.log(error);
      alert("Operation Failed");
    }
  };

  const resetForm = () => {
    setFormData({
      supplierCode: "",
      supplierName: "",
      supplierPhonenumber: "",
      supplierAddress: "",
      supplierVehiclenumber: "",
      supplierCapacity: "",
    });
  };

  const openModal = (supplier = null) => {
    if (supplier) {
      setEditId(supplier._id);
      setFormData({
        supplierCode: supplier.supplierCode,
        supplierName: supplier.supplierName,
        supplierPhonenumber: supplier.supplierPhonenumber,
        supplierAddress: supplier.supplierAddress,
        supplierVehiclenumber: supplier.supplierVehiclenumber,
        supplierCapacity: supplier.supplierCapacity,
      });
    } else {
      setEditId(null);
      resetForm();
    }

    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditId(null);
    resetForm();
  };

  const handleEdit = (supplier) => {
    openModal(supplier);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this supplier?")) return;

    try {
      const response = await deleteSupplier(id);

      if (response.success) {
        alert("Supplier Deleted");
        loadSuppliers();
      }
    } catch (error) {
      console.log(error);
      alert("Delete Failed");
    }
  };

  const handleCancel = () => {
    closeModal();
  };


  const filteredSuppliers = suppliers.filter((supplier) => {

    const matchesSearch =
      supplier.supplierName
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      supplier.supplierCode
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      supplier.supplierPhonenumber.includes(searchTerm);

    const capacity = Number(supplier.supplierCapacity);

    let matchesCapacity = true;

    if (capacityFilter === "lt20") {
      matchesCapacity = capacity < 20;
    } else if (capacityFilter === "20to70") {
      matchesCapacity = capacity >= 20 && capacity < 70;
    } else if (capacityFilter === "gte70") {
      matchesCapacity = capacity >= 70;
    }

    return matchesSearch && matchesCapacity;
  });

  return (
    <div className="users-layout">
      <Sidebar />

      <div className="users-content">
        <h1>Supplier Management</h1>

        <div className="supplier-toolbar">
          <input
            type="text"
            placeholder="Search by Name, Code or Phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-box"
          />

          <div className="supplier-toolbar-actions">
            <select
              value={capacityFilter}
              onChange={(e) => setCapacityFilter(e.target.value)}
              className="capacity-filter"
            >
              <option value="All">All Capacity</option>
              <option value="lt20">Less than 20</option>
              <option value="20to70">20 - 69</option>
              <option value="gte70">70 and Above</option>
            </select>

            <button className="add-supplier-btn" type="button" onClick={() => openModal()}>
              Add Supplier
            </button>
          </div>
        </div>

        {isModalOpen && (
          <div className="supplier-modal-overlay" onClick={closeModal}>
            <div className="supplier-modal" onClick={(e) => e.stopPropagation()}>
              <h2>{editId ? "Edit Supplier" : "Add Supplier"}</h2>

              <form onSubmit={handleSubmit} className="supplier-modal-form">
                <input
                  type="text"
                  name="supplierCode"
                  placeholder="Supplier Code"
                  value={formData.supplierCode}
                  onChange={handleChange}
                  required
                />

                <input
                  type="text"
                  name="supplierName"
                  placeholder="Supplier Name"
                  value={formData.supplierName}
                  onChange={handleChange}
                  required
                />

                <input
                  type="text"
                  name="supplierPhonenumber"
                  placeholder="Phone Number"
                  value={formData.supplierPhonenumber}
                  onChange={handleChange}
                  required
                />

                <input
                  type="text"
                  name="supplierAddress"
                  placeholder="Address"
                  value={formData.supplierAddress}
                  onChange={handleChange}
                  required
                />

                <input
                  type="text"
                  name="supplierVehiclenumber"
                  placeholder="Vehicle Number"
                  value={formData.supplierVehiclenumber}
                  onChange={handleChange}
                  required
                />

                <input
                  type="text"
                  name="supplierCapacity"
                  placeholder="Capacity"
                  value={formData.supplierCapacity}
                  onChange={handleChange}
                  required
                />

                <div className="modal-buttons">
                  <button type="submit">
                    {editId ? "Update Supplier" : "Add Supplier"}
                  </button>
                  <button type="button" onClick={handleCancel}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <table className="users-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Address</th>
              <th>Vehicle</th>
              <th>Capacity</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: "center" }}>
                  No Suppliers Found
                </td>
              </tr>
            ) : (
              filteredSuppliers.map((supplier) => (
                <tr key={supplier._id}>
                  <td>{supplier.supplierCode}</td>
                  <td>{supplier.supplierName}</td>
                  <td>{supplier.supplierPhonenumber}</td>
                  <td>{supplier.supplierAddress}</td>
                  <td>{supplier.supplierVehiclenumber}</td>
                  <td>{supplier.supplierCapacity}</td>
                  <td>
                    {new Date(
                      supplier.createdAt
                    ).toLocaleDateString()}
                  </td>

                <td className="action-column">
  <div className="action-buttons">
   

    <button
      className="edit-btn"
      title="Edit"
      onClick={() => handleEdit(supplier)}
    >
      <FaEdit />
    </button>

    <button
      className="delete-btn"
      title="Delete"
      onClick={() => handleDelete(supplier._id)}
    >
      <FaTrash />
    </button>
  </div>
</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Suppliers;