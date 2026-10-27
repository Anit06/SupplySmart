import { useEffect, useState } from "react";
import Sidebar from "../../common/Sidebar";
import Header from "../../common/Header";
import {
  getInventory,
  addInventory,
  updateInventory,
  deleteInventory
} from "../../../services/inventoryService";

function Inventory() {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [formData, setFormData] = useState({
    warehouseId: "",
    productId: "",
    stock: ""
  });

  const loadInventory = async () => {
    if (!warehouseId) {
      setInventory([]);
      return;
    }

    try {
      setLoading(true);
      setError("");
      const response = await getInventory(warehouseId);
      setInventory(response.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!warehouseId) return;
    let active = true;
    getInventory(warehouseId)
      .then((response) => {
        if (active) setInventory(response.data || []);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Failed to load inventory");
      });

    return () => {
      active = false;
    };
  }, [warehouseId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddInventory = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError("");
      setMessage("");

      const payload = {
        warehouseId: formData.warehouseId,
        productId: formData.productId,
        stock: Number(formData.stock)
      };

      const response = await addInventory(payload);
      setMessage(response?.message || "Inventory added successfully");
      setFormData({ warehouseId: "", productId: "", stock: "" });
      setWarehouseId(payload.warehouseId);
      await loadInventory();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to add inventory");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateInventory = async (inventoryId) => {
    const stockValue = window.prompt("Enter new stock value");

    if (stockValue === null) return;

    try {
      setLoading(true);
      setError("");
      setMessage("");

      const response = await updateInventory(inventoryId, Number(stockValue));
      setMessage(response?.message || "Stock updated successfully");
      await loadInventory();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update inventory");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInventory = async (inventoryId) => {
    if (!window.confirm("Delete this inventory item?")) return;

    try {
      setLoading(true);
      setError("");
      setMessage("");

      const response = await deleteInventory(inventoryId);
      setMessage(response?.message || "Inventory deleted successfully");
      await loadInventory();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete inventory");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-layout">
      <Sidebar />

      <div className="dashboard-main">
        <Header />

        <div style={{ padding: "24px" }}>
          <h1>Inventory</h1>
          <p>Manage warehouse inventory through the Node gateway.</p>

          {message && (
            <div style={{ marginBottom: "12px", color: "green" }}>{message}</div>
          )}

          {error && (
            <div style={{ marginBottom: "12px", color: "red" }}>{error}</div>
          )}

          <form onSubmit={handleAddInventory} style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <input
                type="text"
                name="warehouseId"
                placeholder="Warehouse ID"
                value={formData.warehouseId}
                onChange={handleChange}
                required
              />
              <input
                type="text"
                name="productId"
                placeholder="Product ID"
                value={formData.productId}
                onChange={handleChange}
                required
              />
              <input
                type="number"
                name="stock"
                placeholder="Stock"
                value={formData.stock}
                onChange={handleChange}
                required
              />
              <button
                type="submit"
                disabled={loading}
                style={{
                  background: "#16a34a",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0 18px",
                  height: "40px",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontWeight: 600
                }}
              >
                {loading ? "Saving..." : "Add Inventory"}
              </button>
            </div>
          </form>

          <div style={{ marginBottom: "12px" }}>
            <label>Warehouse to view: </label>
            <input
              type="text"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              placeholder="Enter warehouse ID"
            />
          </div>

          {loading && <p>Loading inventory...</p>}

          {!loading && inventory.length === 0 && warehouseId && (
            <p>No inventory found for this warehouse.</p>
          )}

          {!loading && inventory.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Product Name</th>
                  <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Category</th>
                  <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Warehouse</th>
                  <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Stock</th>
                  <th style={{ borderBottom: "1px solid #ccc", textAlign: "left" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => (
                  <tr key={item.inventoryId || item.id}>
                    <td>{item.productName || "N/A"}</td>
                    <td>{item.category || "N/A"}</td>
                    <td>{item.warehouseName || item.warehouseId || "N/A"}</td>
                    <td>{item.stock}</td>
                    <td>
                      <button
                        onClick={() => handleUpdateInventory(item.inventoryId || item.id)}
                        style={{
                          background: "#16a34a",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          padding: "6px 12px",
                          cursor: "pointer",
                          fontWeight: 600
                        }}
                      >
                        Update Stock
                      </button>
                      <button
                        onClick={() => handleDeleteInventory(item.inventoryId || item.id)}
                        style={{ marginLeft: "8px" }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default Inventory;