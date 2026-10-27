import { useEffect, useState } from "react";
import { FaPlus } from "react-icons/fa";

import Sidebar from "../../common/Sidebar";
import WarehouseCards from "./WarehouseCards";
import SearchFilter from "./SearchFilter";
import WarehouseList from "./WarehouseList";
import AddWarehouse from "./AddWarehouse";
import EditWarehouse from "./EditWarehouse";

import {
  getWarehouses,
  addWarehouse,
  updateWarehouse,
  deleteWarehouse
} from "../../../services/warehouseService";

import "../../../assets/css/warehouse.css";

function Warehouses() {
  const [warehouses, setWarehouses] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editWarehouse, setEditWarehouse] = useState(null);

  useEffect(() => {
    loadWarehouses();
  }, []);

  async function loadWarehouses() {
    const data = await getWarehouses();

    if (data.success) {
      setWarehouses(data.warehouses);
    }
  }

  const handleAdd = async (warehouse) => {
    const data = await addWarehouse(warehouse);

    if (data.success) {
      alert("Warehouse Added");
      setShowModal(false);
      loadWarehouses();
    }
  };

  const handleUpdate = async () => {
    const data = await updateWarehouse(
      editWarehouse._id,
      editWarehouse
    );

    if (data.success) {
      alert("Warehouse Updated");
      setEditWarehouse(null);
      loadWarehouses();
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete Warehouse?")) return;

    await deleteWarehouse(id);
    loadWarehouses();
  };

  const filtered = warehouses.filter((w) => {
    const matchSearch = w.name
      .toLowerCase()
      .includes(search.toLowerCase());

    const matchStatus =
      status === "" || w.status === status;

    return matchSearch && matchStatus;
  });

  return (
    <div className="warehouse-layout">
      <Sidebar />

      <div className="warehouse-content">
        <div className="warehouse-header">
          <div>
            <h1>Warehouses</h1>
            <p>Manage all warehouses.</p>
          </div>

          <button
            className="add-btn"
            onClick={() => setShowModal(true)}
          >
            <FaPlus />
            Add Warehouse
          </button>
        </div>

        <WarehouseCards warehouses={warehouses} />

        <SearchFilter
          search={search}
          setSearch={setSearch}
          status={status}
          setStatus={setStatus}
        />

        <WarehouseList
          warehouses={filtered}
          onEdit={setEditWarehouse}
          onDelete={handleDelete}
        />
      </div>

      {showModal && (
        <AddWarehouse
          handleAdd={handleAdd}
          onClose={() => setShowModal(false)}
        />
      )}

      {editWarehouse && (
        <EditWarehouse
          editWarehouse={editWarehouse}
          setEditWarehouse={setEditWarehouse}
          handleUpdate={handleUpdate}
          onClose={() => setEditWarehouse(null)}
        />
      )}
    </div>
  );
}

export default Warehouses;