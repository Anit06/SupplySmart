import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaPlus,
  FaSearch,
  FaEdit,
  FaTrash,
  FaTimes
} from "react-icons/fa";
import {
  useNavigate,
  useParams
} from "react-router-dom";

import Sidebar from "../../common/Sidebar";
import Toast from "../../common/Toast";

import {
  getInventory,
  addInventory,
  updateInventory,
  deleteInventory
} from "../../../services/inventoryService";

import {
  getWarehouseById
} from "../../../services/warehouseService";

import {
  getProducts
} from "../../../services/productService";

import "../../../assets/css/warehouse.css";

const getProductUnallocatedStock = (productObj) => {
  if (!productObj) return 0;
  if (productObj.stock !== undefined) return Number(productObj.stock);
  if (productObj.availableStock !== undefined) return Number(productObj.availableStock);
  if (productObj.quantity !== undefined) return Number(productObj.quantity);
  return 0;
};

function InventoryView() {
  const { warehouseId } = useParams();
  const navigate = useNavigate();

  const [warehouse, setWarehouse] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [stockInput, setStockInput] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [productSearchLoading, setProductSearchLoading] = useState(false);

  // Edit states
  const [editItem, setEditItem] = useState(null);
  const [editStockAmount, setEditStockAmount] = useState("");
  const [editMode, setEditMode] = useState("ADD"); // "ADD" or "REMOVE"
  
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState({
    message: "",
    type: "success"
  });

  // Compute filtered warehouse inventory list
  const filteredInventory = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return inventory;
    return inventory.filter(
      (item) =>
        (item.sku || "").toLowerCase().includes(query) ||
        (item.productName || "").toLowerCase().includes(query)
    );
  }, [search, inventory]);

  // Find the master product metadata for the item currently being edited
  const editProductSource = useMemo(() => {
    if (!editItem || !products.length) return null;
    return products.find(p => (p._id || p.id) === editItem.productId) || null;
  }, [editItem, products]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setProductSearchLoading(true);
      const keyword = productSearch.toLowerCase().trim();
      const existingProducts = new Set(
        inventory.map(item => item.productId)
      );

      let result = products.filter(product => {
        const id = product._id || product.id;
        if (existingProducts.has(id)) return false;
        if (!keyword) return true;

        return (
          (product.sku || "").toLowerCase().includes(keyword) ||
          (product.name || "").toLowerCase().includes(keyword)
        );
      });

      setProductSearchResults(result);
      setProductSearchLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [productSearch, products, inventory]);

  const loadInventory = useCallback(async () => {
    try {
      setLoading(true);
      const inventoryResponse = await getInventory(warehouseId);
      const inventoryList = inventoryResponse.data || inventoryResponse || [];

      const productResponse = await getProducts();
      const productList = productResponse.success ? productResponse.products : [];

      setProducts(productList);

      const data = inventoryList.map(item => {
        const product = productList.find(p =>
          (p._id || p.id) === item.productId
        );

        return {
          ...item,
          sku: product?.sku || item.sku || "-",
          productName: product?.name || item.productName || "-",
          category: product?.category || item.category || "-",
          unit: product?.unit || item.unit || "",
          availableStock: product ? getProductUnallocatedStock(product) : 0
        };
      });

      setInventory(data);
    } catch (error) {
      setToast({
        message: error.response?.data?.message || "Failed to load inventory",
        type: "error"
      });
    } finally {
      setLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => {
    if (!warehouseId) return;
    let active = true;
    Promise.all([
      getWarehouseById(warehouseId),
      getInventory(warehouseId),
      getProducts()
    ])
      .then(([warehouseResponse, inventoryResponse, productResponse]) => {
        if (!active) return;
        if (warehouseResponse.success) setWarehouse(warehouseResponse.warehouse);
        const inventoryList = inventoryResponse.data || inventoryResponse || [];
        const productList = productResponse.success ? productResponse.products : [];
        setProducts(productList);
        setInventory(inventoryList.map((item) => {
          const product = productList.find((entry) =>
            (entry._id || entry.id) === item.productId
          );
          return {
            ...item,
            sku: product?.sku || item.sku || "-",
            productName: product?.name || item.productName || "-",
            category: product?.category || item.category || "-",
            unit: product?.unit || item.unit || "",
            availableStock: product ? getProductUnallocatedStock(product) : 0
          };
        }));
      })
      .catch((error) => {
        if (active) {
          setToast({
            message: error.response?.data?.message || "Failed to load inventory",
            type: "error"
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [warehouseId]);

  const handleAddInventory = async (event) => {
    event.preventDefault();
    setFormError("");

    if (!selectedProduct) {
      setFormError("Please select a product.");
      return;
    }

    const stock = Number(stockInput);
    if (!Number.isFinite(stock) || stock <= 0) {
      setFormError("Please enter a valid stock quantity.");
      return;
    }

    const availablePoolStock = getProductUnallocatedStock(selectedProduct);
    if (stock > availablePoolStock) {
      setFormError(`Only ${availablePoolStock} units are left unallocated in the central pool.`);
      return;
    }

    try {
      await addInventory({
        warehouseId,
        productId: selectedProductId,
        stock
      });

      setShowModal(false);
      setSelectedProductId("");
      setSelectedProduct(null);
      setStockInput("");
      setProductSearch("");
      setProductSearchResults([]);
      setFormError("");

      await loadInventory();

      setToast({
        message: "Product added successfully",
        type: "success"
      });
    } catch (error) {
      setFormError(
        error.response?.data?.message ||
        error.response?.data?.error ||
        "Unable to add product."
      );
    }
  };

  // Tracks live input changes against real master unallocated stock pool
  const handleLiveStockInputChange = (value, mode, item, structuralProduct) => {
    setEditStockAmount(value);
    
    if (!item || !structuralProduct) return;
    const adjustmentAmount = Number(value);
    const maxCapacityAllowed = getProductUnallocatedStock(structuralProduct);

    if (!value) {
      setFormError("");
      return;
    }

    if (!Number.isFinite(adjustmentAmount) || adjustmentAmount <= 0) {
      setFormError("Enter a valid adjustment value greater than 0.");
      return;
    }

    if (mode === "ADD") {
      if (adjustmentAmount > maxCapacityAllowed) {
        setFormError(`Warning: Entering ${adjustmentAmount} units will cross your maximum available capacity headroom (${maxCapacityAllowed}).`);
      } else {
        setFormError("");
      }
    } else if (mode === "REMOVE") {
      const currentWarehouseStock = Number(item.stock) || 0;
      if (adjustmentAmount > currentWarehouseStock) {
        setFormError(`Cannot remove more than the current warehouse stock level (${currentWarehouseStock}).`);
      } else {
        setFormError("");
      }
    }
  };

  const handleUpdate = async (event) => {
    event.preventDefault();
    setFormError("");
    if (!editItem || !editProductSource) return;

    const adjustmentAmount = Number(editStockAmount);
    if (!Number.isFinite(adjustmentAmount) || adjustmentAmount <= 0) {
      setFormError("Enter a valid adjustment value greater than 0.");
      return;
    }

    const currentWarehouseStock = Number(editItem.stock) || 0;
    const maxCapacityAllowed = getProductUnallocatedStock(editProductSource);
    let finalCalculatedStock = currentWarehouseStock;

    if (editMode === "ADD") {
      if (adjustmentAmount > maxCapacityAllowed) {
        setFormError(`Cannot exceed unallocated capacity ceiling. Only ${maxCapacityAllowed} units available.`);
        return;
      }
      finalCalculatedStock = currentWarehouseStock + adjustmentAmount;
    } else if (editMode === "REMOVE") {
      if (adjustmentAmount > currentWarehouseStock) {
        setFormError(`Cannot remove more than the current stock level (${currentWarehouseStock}).`);
        return;
      }
      finalCalculatedStock = currentWarehouseStock - adjustmentAmount;
    }

    try {
      await updateInventory(editItem.inventoryId || editItem.id, finalCalculatedStock);
      setEditItem(null);
      setEditStockAmount("");
      setFormError("");
      await loadInventory();

      setToast({
        message: `Stock updated successfully to ${finalCalculatedStock}`,
        type: "success"
      });
    } catch (error) {
      setFormError(
        error.response?.data?.message || 
        "Unable to update stock."
      );
    }
  };

  const handleDelete = async (item) => {
    const confirmDelete = window.confirm("Remove this product from the warehouse?");
    if (!confirmDelete) return;

    try {
      await deleteInventory(item.inventoryId || item.id);
      await loadInventory();

      setToast({
        message: "Product removed successfully",
        type: "success"
      });
    } catch (error) {
      setToast({
        message: error.response?.data?.message || "Unable to remove product.",
        type: "error"
      });
    }
  };

  const getStockStatus = (stock) => {
    if (stock <= 0) return "Out Of Stock";
    if (stock <= 20) return "Low Stock";
    return "In Stock";
  };

  return (
    <div className="warehouse-layout">
      <Sidebar />

      <div className="warehouse-content">
        <button
          className="cancel-btn"
          style={{ marginBottom: "16px" }}
          onClick={() => navigate(-1)}
        >
          Back to Warehouses
        </button>

        <div className="inventory-hero-card">
          <div>
            <p className="inventory-eyebrow">Warehouse Inventory</p>
            <h1>{warehouse?.name || "Warehouse Inventory"}</h1>

            <div className="inventory-meta-grid">
              <div>
                <span className="inventory-label">Warehouse Code</span>
                <p>{warehouse?.code || "-"}</p>
              </div>
              <div>
                <span className="inventory-label">Location</span>
                <p>{warehouse?.location || "-"}</p>
              </div>
              <div>
                <span className="inventory-label">Manager</span>
                <p>{warehouse?.manager || "-"}</p>
              </div>
              <div>
                <span className="inventory-label">Status</span>
                <p>{warehouse?.status || "-"}</p>
              </div>
            </div>
          </div>

          <div className="inventory-toolbar">
            <div className="inventory-search-box">
              <FaSearch />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU or Product"
              />
            </div>

            <button
              className="add-btn"
              onClick={() => {
                setShowModal(true);
                setSelectedProduct(null);
                setSelectedProductId("");
                setStockInput("");
                setProductSearch("");
                setFormError("");
              }}
            >
              <FaPlus /> Add Product
            </button>
          </div>
        </div>

        {loading ? (
          <div className="inventory-loading">Loading Inventory...</div>
        ) : (
          <div className="warehouse-table-wrapper">
            <table className="warehouse-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Stock</th>
                  <th>Unit</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="inventory-empty">
                      No products found.
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map((item) => (
                    <tr key={item.inventoryId || item.id}>
                      <td>{item.sku || "-"}</td>
                      <td>{item.productName || "-"}</td>
                      <td>{item.category || "-"}</td>
                      <td>{item.stock}</td>
                      <td>{item.unit || "-"}</td>
                      <td>
                        <span
                          className={`status ${getStockStatus(item.stock)
                            .toLowerCase()
                            .replace(/\s+/g, "-")}`}
                        >
                          {getStockStatus(item.stock)}
                        </span>
                      </td>
                      <td>
                        <div className="action-buttons">
                          <button
                            className="action-btn edit"
                            onClick={() => {
                              setEditItem(item);
                              setEditStockAmount("");
                              setEditMode("ADD");
                              setFormError("");
                            }}
                          >
                            <FaEdit />
                          </button>
                          <button
                            className="action-btn delete"
                            onClick={() => handleDelete(item)}
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
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="warehouse-modal">
            <div className="modal-title-row">
              <h2>Add Product</h2>
              <button
                className="icon-btn"
                onClick={() => {
                  setShowModal(false);
                  setSelectedProduct(null);
                  setSelectedProductId("");
                  setStockInput("");
                  setProductSearch("");
                  setFormError("");
                }}
              >
                <FaTimes />
              </button>
            </div>

            <form className="warehouse-form" onSubmit={handleAddInventory}>
              <div className="form-group full-width">
                <label>Search Product</label>
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search SKU or Product"
                />
              </div>

              <div className="form-group full-width">
                <label>Select Product</label>
                <div className="inventory-dropdown">
                  {productSearchLoading ? (
                    <div className="inventory-dropdown-empty">Loading...</div>
                  ) : productSearchResults.length === 0 ? (
                    <div className="inventory-dropdown-empty">No Products</div>
                  ) : (
                    productSearchResults.map((product) => {
                      const pId = product._id || product.id;
                      return (
                        <button
                          key={pId}
                          type="button"
                          className={
                            selectedProductId === pId
                              ? "inventory-option active"
                              : "inventory-option"
                          }
                          onClick={() => {
                            setSelectedProduct(product);
                            setSelectedProductId(pId);
                            setFormError("");
                          }}
                        >
                          <strong>{product.sku}</strong>
                          <span>{product.name}</span>
                          <small>{product.category}</small>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {selectedProduct && (
                <div className="form-group full-width">
                  <div className="available-stock-box">
                    <strong>Max Available Capacity :</strong>{" "}
                    {getProductUnallocatedStock(selectedProduct)}
                  </div>
                </div>
              )}

              <div className="form-group full-width">
                <label>Stock</label>
                <input
                  type="number"
                  min="1"
                  value={stockInput}
                  onChange={(e) => {
                    setStockInput(e.target.value);
                    setFormError("");
                  }}
                />
              </div>

              {formError && <div className="form-error">{formError}</div>}

              <div className="modal-buttons">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setShowModal(false);
                    setSelectedProduct(null);
                    setSelectedProductId("");
                    setStockInput("");
                    setProductSearch("");
                    setFormError("");
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="save-btn">
                  Add Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editItem && (
        <div className="modal-overlay">
          <div className="warehouse-modal small-modal">
            <div className="modal-title-row">
              <h2>Adjust Stock</h2>
              <button
                className="icon-btn"
                onClick={() => {
                  setEditItem(null);
                  setEditStockAmount("");
                  setFormError("");
                }}
              >
                <FaTimes />
              </button>
            </div>

            <form className="warehouse-form" onSubmit={handleUpdate}>
              <div className="form-group full-width" style={{ marginBottom: "12px" }}>
                <div className="available-stock-box" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span><strong>Current Stock:</strong> {editItem.stock}</span>
                  <span>
                    <strong>Max Available Capacity:</strong>{" "}
                    {Math.max(0, getProductUnallocatedStock(editProductSource) - (Number(editStockAmount) || 0))}
                  </span>
                </div>
              </div>

              {/* Mode Selection Tab Buttons */}
              <div className="form-group full-width" style={{ marginBottom: "16px" }}>
                <label style={{ marginBottom: "6px", display: "block" }}>Action Mode</label>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: "8px",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                      backgroundColor: editMode === "ADD" ? "#28a745" : "#f8f9fa",
                      color: editMode === "ADD" ? "#fff" : "#333",
                      fontWeight: "bold",
                      cursor: "pointer"
                    }}
                    onClick={() => {
                      setEditMode("ADD");
                      handleLiveStockInputChange("", "ADD", editItem, editProductSource);
                    }}
                  >
                    + Add Stock
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: "8px",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                      backgroundColor: editMode === "REMOVE" ? "#dc3545" : "#f8f9fa",
                      color: editMode === "REMOVE" ? "#fff" : "#333",
                      fontWeight: "bold",
                      cursor: "pointer"
                    }}
                    onClick={() => {
                      setEditMode("REMOVE");
                      handleLiveStockInputChange("", "REMOVE", editItem, editProductSource);
                    }}
                  >
                    - Remove Stock
                  </button>
                </div>
              </div>

              <div className="form-group full-width">
                <label>Quantity to {editMode === "ADD" ? "Add" : "Remove"}</label>
                <input
                  type="number"
                  min="1"
                  value={editStockAmount}
                  placeholder={`Enter units to ${editMode.toLowerCase()}`}
                  onChange={(e) => 
                    handleLiveStockInputChange(e.target.value, editMode, editItem, editProductSource)
                  }
                />
              </div>

              {formError && <div className="form-error">{formError}</div>}

              <div className="modal-buttons">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => {
                    setEditItem(null);
                    setEditStockAmount("");
                    setFormError("");
                  }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="save-btn" 
                  style={{ backgroundColor: editMode === "REMOVE" ? "#dc3545" : "" }}
                >
                  Confirm {editMode === "ADD" ? "Addition" : "Removal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <Toast
        message={toast.message}
        type={toast.type}
        onClose={() =>
          setToast({
            message: "",
            type: "success"
          })
        }
      />
    </div>
  );
}

export default InventoryView;