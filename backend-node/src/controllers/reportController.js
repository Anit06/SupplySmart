const reportService = require("../services/reportService");
const inventoryReport = require("../reports/inventoryReport");

const salesReport = require("../reports/salesReport");

const logReportFailure = (event, error) => {
  console.error(JSON.stringify({
    event,
    errorCode: String(error.code || error.name || "REPORT_ERROR").slice(0, 80),
    statusCode: error.response?.status || null
  }));
};

//Inventory Report
exports.getInventoryReport = async (req, res) => {
  try {
    const inventory = await reportService.getInventoryReport();

    res.status(200).json({
      success: true,

      totalProducts: inventory.length,

      inventory,
    });
  } catch (error) {
    logReportFailure("inventory_report_failed", error);

    res.status(500).json({
      success: false,

      message: "Failed to fetch inventory report",
    });
  }
};

//Summary Report

exports.getSummaryReport = async (req, res) => {
  try {
    const summary = await reportService.getSummaryReport();

    res.status(200).json({
      success: true,

      summary,
    });
  } catch (error) {
    logReportFailure("summary_report_failed", error);

    res.status(500).json({
      success: false,

      message: "Failed to fetch summary report",
    });
  }
};


//Low Stock Report

exports.getLowStockReport = async (req, res) => {
  try {
    const products = await reportService.getLowStockReport();

    res.status(200).json({
      success: true,

      totalLowStockProducts: products.length,

      products,
    });
  } catch (error) {
    logReportFailure("low_stock_report_failed", error);

    res.status(500).json({
      success: false,

      message: "Failed to fetch low stock report",
    });
  }
};


//EXPORT PDF

exports.exportInventoryPDF = async (req, res) => {
  try {
    const inventory = await reportService.getInventoryReport();

    const summary = await reportService.getSummaryReport();

    const warehouseCapacity = await reportService.getWarehouseCapacityReport();

    inventoryReport.generateInventoryPDF(
      res,

      inventory,

      summary,
      warehouseCapacity,
    );
  } catch (error) {
    logReportFailure("inventory_pdf_export_failed", error);

    res.status(500).json({
      success: false,

      message: "Failed to export PDF",
    });
  }
};


//EXPORT EXCEL


exports.exportInventoryExcel = async (req, res) => {
  try {
    const inventory = await reportService.getInventoryReport();

    const warehouseCapacity = await reportService.getWarehouseCapacityReport();

    await inventoryReport.generateInventoryExcel(
      res,

      inventory,
      warehouseCapacity,
    );
  } catch (error) {
    logReportFailure("inventory_excel_export_failed", error);

    res.status(500).json({
      success: false,

      message: "Failed to export Excel",
    });
  }
};

/*
====================================
MONTHLY SALES REPORT
====================================
*/

exports.getMonthlySalesReport = async (req, res) => {
    try {
        const { warehouseId, month, year } = req.query;

        const report = await reportService.getMonthlySalesReport(
            warehouseId,
            Number(month),
            Number(year)
        );

        res.status(200).json({
            success: true,
            report
        });

    } catch (error) {
        logReportFailure("monthly_sales_report_failed", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch monthly sales report"
        });
    }
};

exports.exportMonthlySalesPDF = async (req, res) => {
    console.log("PDF API HIT");

    try {
        const { warehouseId, month, year } = req.query;

        const report = await reportService.getMonthlySalesReport(
            warehouseId,
            Number(month),
            Number(year)
        );

        salesReport.generateMonthlySalesPDF(res, report);

    } catch (error) {
        logReportFailure("monthly_sales_pdf_export_failed", error);

        res.status(500).json({
            success: false,
            message: "Failed to export PDF"
        });
    }
};

exports.exportMonthlySalesExcel = async (req, res) => {

    try {

        const { warehouseId, month, year } = req.query;

        const report = await reportService.getMonthlySalesReport(
            warehouseId,
            Number(month),
            Number(year)
        );

        await salesReport.generateMonthlySalesExcel(
            res,
            report
        );

    } catch (error) {

        logReportFailure("monthly_sales_excel_export_failed", error);

        res.status(500).json({
            success: false,
            message: "Failed to export Excel"
        });

    }

};

/*
====================================
YEARLY SALES REPORT
====================================
*/

exports.getYearlySalesReport = async (req, res) => {

    try {

        const { warehouseId, year } = req.query;

        if (!warehouseId || !year) {

            return res.status(400).json({

                success: false,

                message: "warehouseId and year are required"

            });

        }

        const report = await reportService.getYearlySalesReport(

            warehouseId,

            Number(year)

        );

        res.status(200).json({

            success: true,

            report

        });

    }

    catch (error) {

        logReportFailure("yearly_sales_report_failed", error);

        res.status(500).json({

            success: false,

            message: "Failed to fetch yearly sales report"

        });

    }

};

/*
====================================
EXPORT YEARLY SALES PDF
====================================
*/

exports.exportYearlySalesPDF = async (req, res) => {

    try {

        const { warehouseId, year } = req.query;

        const report = await reportService.getYearlySalesReport(
            warehouseId,
            Number(year)
        );

        salesReport.generateYearlySalesPDF(
            res,
            report
        );

    } catch (error) {

        logReportFailure("yearly_sales_pdf_export_failed", error);

        res.status(500).json({
            success: false,
            message: "Failed to export yearly PDF"
        });

    }

};

exports.exportYearlySalesExcel = async (req, res) => {

    try {

        const { warehouseId, year } = req.query;

        const report = await reportService.getYearlySalesReport(
            warehouseId,
            Number(year)
        );

        await salesReport.generateYearlySalesExcel(
            res,
            report
        );

    } catch (error) {

        logReportFailure("yearly_sales_excel_export_failed", error);

        res.status(500).json({
            success: false,
            message: "Failed to export yearly Excel"
        });

    }

};