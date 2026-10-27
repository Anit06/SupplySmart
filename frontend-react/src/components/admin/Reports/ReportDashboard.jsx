import { useEffect, useMemo, useState } from "react";

import {
  FaBoxes,
  FaWarehouse,
  FaChevronDown,
  FaChevronRight,
} from "react-icons/fa";

import {
  MdInventory,
  MdOutlineSpaceDashboard,
} from "react-icons/md";

import {
  getInventoryReport,
  getSummaryReport,
  getLowStockReport,
  downloadInventoryPDF,
  downloadInventoryExcel,
} from "../../../services/reportService";

function ReportDashboard() {
  const [summary, setSummary] = useState({
    totalProducts: 0,
    totalStock: 0,
    lowStock: 0,
    totalWarehouses: 0,
    totalCapacity: 0,
    usedCapacity: 0,
    availableCapacity: 0,
    capacityPercentage: 0,
  });

  const [inventory, setInventory] = useState([]);

  const [lowStockProducts, setLowStockProducts] = useState([]);

  const [loading, setLoading] = useState(true);

  const [openWarehouse, setOpenWarehouse] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      getSummaryReport(),
      getInventoryReport(),
      getLowStockReport(),
    ])
      .then(([summaryRes, inventoryRes, lowStockRes]) => {
        if (!active) return;
        setSummary(summaryRes.data.summary);
        const inventoryData = inventoryRes.data.inventory || [];
        setInventory(inventoryData);
        if (inventoryData.length > 0) {
          setOpenWarehouse(inventoryData[0].warehouseName);
        }
        setLowStockProducts(lowStockRes.data.products || []);
      })
      .catch((error) => console.log(error))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  //DOWNLOAD PDF

  const handlePDF = async () => {
    try {
      setPdfLoading(true);

      await downloadInventoryPDF();
    } catch (error) {
      console.error(error);

      alert("Failed to generate PDF.");
    } finally {
      setPdfLoading(false);
    }
  };

  //DOWNLOAD EXCEL

  const handleExcel = async () => {
    try {
      setExcelLoading(true);

      await downloadInventoryExcel();
    } catch (error) {
      console.error(error);

      alert("Failed to export Excel.");
    } finally {
      setExcelLoading(false);
    }
  };

  const groupedInventory = useMemo(() => {
    const grouped = {};

    inventory.forEach((item) => {
      if (!grouped[item.warehouseName]) {
        grouped[item.warehouseName] = [];
      }

      grouped[item.warehouseName].push(item);
    });

    return grouped;
  }, [inventory]);

  if (loading) {
    return <h3>Loading Reports...</h3>;
  }

  return (
    <div className="reports-dashboard">
      {/* Summary */}
      <div className="report-summary">
        <div className="summary-card">
          <FaBoxes className="summary-icon" />

          <h5>Total Products</h5>

          <h2>{summary.totalProducts}</h2>
        </div>

        <div className="summary-card">
          <FaWarehouse className="summary-icon" />

          <h5>Total Warehouses</h5>

          <h2>{summary.totalWarehouses}</h2>
        </div>

        <div className="summary-card">
          <MdInventory className="summary-icon" />

          <h5>Total Stock</h5>

          <h2>{summary.totalStock}</h2>
        </div>

        <div className="summary-card">
          <MdOutlineSpaceDashboard className="summary-icon" />

          <h5>Capacity Used</h5>

          <h2>
            {summary.usedCapacity} / {summary.totalCapacity}
          </h2>

          <small>{summary.capacityPercentage}% Used</small>
          <div className="capacity-progress">
            <div
              className="capacity-progress-fill"
              style={{
                width: `${summary.capacityPercentage}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Inventory */}

      <div className="report-section">
        <h3>Inventory By Warehouse</h3>
        {Object.keys(groupedInventory).map((warehouse) => (
          <div className="warehouse-card" key={warehouse}>
            <div
              className="warehouse-header"
              onClick={() =>
                setOpenWarehouse(openWarehouse === warehouse ? "" : warehouse)
              }
            >
              <div className="warehouse-title">
                {openWarehouse === warehouse ? (
                  <FaChevronDown style={{ marginRight: "6px" }} />
                ) : (
                  <FaChevronRight style={{ marginRight: "6px" }} />
                )}

                <FaWarehouse style={{ marginRight: "10px" }} />

                <strong>{warehouse}</strong>
              </div>

              <div className="warehouse-count" marginLeft="5px"></div>
            </div>

            {openWarehouse === warehouse && (
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Product</th>

                    <th>Category</th>

                    <th>Stock</th>

                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {groupedInventory[warehouse].map((item) => (
                    <tr key={item.inventoryId}>
                      <td>{item.productName}</td>

                      <td>{item.category}</td>

                      <td>{item.stock}</td>

                      <td>
                        {item.stock === 0 && (
                          <span className="status danger">Out Of Stock</span>
                        )}

                        {item.stock > 0 && item.stock <= 20 && (
                          <span className="status warning">Low Stock</span>
                        )}

                        {item.stock > 20 && (
                          <span className="status success">In Stock</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {/* LOW STOCK */}

      <div className="report-section">
        <h3>Low Stock Products</h3>

        {lowStockProducts.length === 0 ? (
          <p>No low stock products found.</p>
        ) : (
          <table className="report-table">
            <thead>
              <tr>
                <th>Product</th>

                <th>Warehouse</th>

                <th>Category</th>

                <th>Stock</th>
              </tr>
            </thead>

            <tbody>
              {lowStockProducts.map((item) => (
                <tr key={item.inventoryId}>
                  <td>{item.productName}</td>

                  <td>{item.warehouseName}</td>

                  <td>{item.category}</td>

                  <td>
                    <span className="status warning">{item.stock}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* EXPORT */}

      <div className="report-export-card">
        <div>
          <h3>Export Reports</h3>

          <p>Download warehouse inventory reports in PDF or Excel format.</p>
        </div>

        <div className="report-buttons">
          <button className="pdf-btn" onClick={handlePDF} disabled={pdfLoading}>
            {pdfLoading ? "Generating..." : "Generate PDF"}
          </button>

          <button
            className="excel-btn"
            onClick={handleExcel}
            disabled={excelLoading}
          >
            {excelLoading ? "Exporting..." : "Export Excel"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReportDashboard;
