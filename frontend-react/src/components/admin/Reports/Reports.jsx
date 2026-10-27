import { useState } from "react";

import Sidebar from "../../common/Sidebar";

import { FaChevronDown, FaChevronRight } from "react-icons/fa";

import ReportDashboard from "./ReportDashboard";
import ReportSales from "./ReportSales";

import "../../../assets/css/reports.css";

function Reports() {
  const [openSection, setOpenSection] = useState("warehouse");

  return (
    <div className="dashboard-layout">
      <Sidebar />

      <div className="dashboard-main">
        <div className="reports-container">
          {/* Warehouse Reports */}

          <div className="report-group">
            <div
              className="report-group-header"
              onClick={() =>
                setOpenSection(openSection === "warehouse" ? "" : "warehouse")
              }
            >
              {openSection === "warehouse" ? (
                <FaChevronDown />
              ) : (
                <FaChevronRight />
              )}

              <h3>Warehouse Reports</h3>
            </div>

            {openSection === "warehouse" && <ReportDashboard />}
          </div>

          {/* Sales Reports */}

          <div className="report-group">
            <div
              className="report-group-header"
              onClick={() =>
                setOpenSection(openSection === "sales" ? "" : "sales")
              }
            >
              {openSection === "sales" ? <FaChevronDown /> : <FaChevronRight />}

              <h3>Sales Reports</h3>
            </div>

            {openSection === "sales" && <ReportSales />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Reports;
