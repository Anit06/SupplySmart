import { useEffect, useState } from "react";

import { FaWarehouse, FaFilePdf, FaFileExcel } from "react-icons/fa";

import { MdAttachMoney, MdShoppingCart } from "react-icons/md";

import {
  getMonthlySalesReport,
  getYearlySalesReport,
  downloadMonthlySalesPDF,
  downloadMonthlySalesExcel,
  downloadYearlySalesPDF,
  downloadYearlySalesExcel,
} from "../../../services/reportService";

import { getWarehouses } from "../../../services/warehouseService";

function ReportSales() {
  const [warehouses, setWarehouses] = useState([]);

  const [warehouseId, setWarehouseId] = useState("");

  const [reportType, setReportType] = useState("monthly");

  const [month, setMonth] = useState(new Date().getMonth() + 1);

  const [year, setYear] = useState(new Date().getFullYear());

  const [report, setReport] = useState(null);

  const [loading, setLoading] = useState(false);

  const [pdfLoading, setPdfLoading] = useState(false);

  const [excelLoading, setExcelLoading] = useState(false);

  useEffect(() => {
    let active = true;
    getWarehouses()
      .then((data) => {
        if (!active) return;
        setWarehouses(data.warehouses || []);
        if (data.warehouses?.length > 0) {
          setWarehouseId(data.warehouses[0]._id);
        }
      })
      .catch((error) => console.log(error));

    return () => {
      active = false;
    };
  }, []);

  const handleViewReport = async () => {
    if (!warehouseId) return;

    try {
      setLoading(true);

      let response;

      if (reportType === "monthly") {
        response = await getMonthlySalesReport(warehouseId, month, year);
      } else {
        response = await getYearlySalesReport(warehouseId, year);
      }

      setReport(response.data.report);
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePDF = async () => {
    try {
      setPdfLoading(true);

      if (reportType === "monthly") {
        await downloadMonthlySalesPDF(warehouseId, month, year);
      } else {
        await downloadYearlySalesPDF(warehouseId, year);
      }
    } finally {
      setPdfLoading(false);
    }
  };

  const handleExcel = async () => {
    try {
      setExcelLoading(true);

      if (reportType === "monthly") {
        await downloadMonthlySalesExcel(warehouseId, month, year);
      } else {
        await downloadYearlySalesExcel(warehouseId, year);
      }
    } finally {
      setExcelLoading(false);
    }
  };

  return (
    <div>
      {/* HEADER */}

      <div className="report-header">
        <div>
          <h2>Sales Reports</h2>

          <p>Analyze warehouse-wise monthly and yearly sales reports.</p>
        </div>

        <span className="warehouse-badge">
          <FaWarehouse  style={{marginRight:"8px"}}/>
          Sales Analytics
        </span>
      </div>

      {/* FILTERS */}

      <div className="sales-filter-card">
        <select
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          {warehouses.map((warehouse) => (
            <option key={warehouse._id} value={warehouse._id}>
              {warehouse.name}
            </option>
          ))}
        </select>

        <select
          value={reportType}
          onChange={(e) => setReportType(e.target.value)}
        >
          <option value="monthly">Monthly</option>

          <option value="yearly">Yearly</option>
        </select>

        {reportType === "monthly" && (
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        )}

        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />

        <button className="view-btn" onClick={handleViewReport}>
          {loading ? "Loading..." : "View Report"}
        </button>
      </div>

      {report && (
        <>
          {/* SUMMARY */}

          <div className="report-summary">
            <div className="summary-card">
              <MdAttachMoney className="summary-icon" />

              <h5>Total Revenue</h5>

              <h2>₹{report.grandTotalRevenue.toLocaleString("en-IN")}</h2>
            </div>

            <div className="summary-card">
              <MdShoppingCart className="summary-icon" />

              <h5>Products Sold</h5>

              <h2>{report.products.length}</h2>
            </div>
          </div>

          {/* REPORT INFO */}

          <div className="report-section">
            <h3>{report.warehouseName}</h3>

            <p>
              {reportType === "monthly"
                ? `Monthly Report (${month}/${year})`
                : `Yearly Report (${year})`}
            </p>
          </div>

          {/* TABLE */}

          <div className="report-section">
            <table className="report-table">
              <thead>
                <tr>
                  <th>#</th>

                  <th>Product</th>

                  <th>Unit</th>

                  <th>Quantity Sold</th>

                  <th>Revenue</th>
                </tr>
              </thead>

              <tbody>
                {report.products.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      style={{
                        textAlign: "center",
                      }}
                    >
                      No sales found.
                    </td>
                  </tr>
                ) : (
                  report.products.map((product, index) => (
                    <tr key={product._id}>
                      <td>{index + 1}</td>

                      <td>{product.productName}</td>

                      <td>{product.unit}</td>

                      <td>{product.quantitySold}</td>

                      <td>₹{product.revenue.toLocaleString("en-IN")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* EXPORT */}

          <div className="report-export-card">
            <div>
              <h3>Export Sales Report</h3>

              <p>Download the sales report in PDF or Excel format.</p>
            </div>

            <div className="report-buttons">
              <button
                className="pdf-btn"
                onClick={handlePDF}
                disabled={pdfLoading}
              >
                <FaFilePdf />
                &nbsp;
                {pdfLoading ? "Generating..." : "Generate PDF"}
              </button>

              <button
                className="excel-btn"
                onClick={handleExcel}
                disabled={excelLoading}
              >
                <FaFileExcel />
                &nbsp;
                {excelLoading ? "Exporting..." : "Export Excel"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ReportSales;
