import { useEffect, useMemo, useState } from "react";
import {
  FaBoxOpen,
  FaClipboardList,
  FaRupeeSign,
  FaWarehouse,
  FaChartLine,
  FaBoxes,
} from "react-icons/fa";

import "../../../assets/css/dashboard.css";
import DashboardHeader from "./DashboardHeader";
import Sidebar from "../../common/Sidebar";
import StatsCard from "../../cards/StatsCard";
import SalesChart from "../../charts/SalesChart";
import InventoryChart from "../../charts/InventoryChart";
import RecentOrders from "../../tables/RecentOrders";
import PredictionTable from "../../tables/PredictionTable";
import WarehouseTable from "../../tables/WarehouseTable";

import { getProducts } from "../../../services/productService";
import { getAllOrders } from "../../../services/orderService";
import { getWarehouses } from "../../../services/warehouseService";
import { getStoredPredictions } from "../../../services/aiService";
import { getInventory } from "../../../services/inventoryService";

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function AdminHome() {
  const [dashboard, setDashboard] = useState({
    products: [],
    orders: [],
    warehouses: [],
    predictions: [],
    inventory: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      const results = await Promise.allSettled([
        getProducts(),
        getAllOrders(),
        getWarehouses(),
        getStoredPredictions(),
      ]);

      if (!active) return;

      const value = (index, key) => {
        const response = results[index].status === "fulfilled" ? results[index].value : null;
        return Array.isArray(response) ? response : response?.[key] || [];
      };

      const products = value(0, "products");
      const warehouses = value(2, "warehouses");

      let inventory = [];
      if (warehouses.length) {
        const inventoryResults = await Promise.allSettled(
          warehouses.map((warehouse) => getInventory(warehouse._id || warehouse.id))
        );

        inventory = inventoryResults.flatMap((result) => {
          const response = result.status === "fulfilled" ? result.value : null;
          const rows = Array.isArray(response) ? response : response?.data || [];
          return Array.isArray(rows) ? rows : [];
        });
      }

      setDashboard({
        products,
        orders: value(1, "orders"),
        warehouses,
        predictions: value(3, "predictions"),
        inventory,
      });
      setLoading(false);
    };

    loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  const computed = useMemo(() => {
    const { products, orders, warehouses, inventory } = dashboard;

    const productMap = new Map(
      products.map((product) => [String(product._id || product.id), product])
    );

    const toKg = (quantity, unit) => {
      const amount = Number(quantity || 0);
      const normalized = String(unit || "KG").trim().toUpperCase();

      if (!Number.isFinite(amount)) return 0;
      if (normalized === "G" || normalized === "GRAM") return amount / 1000;
      if (normalized === "ML" || normalized === "LITER" || normalized === "LITRE") return amount / 1000;
      return amount;
    };

    const holdingValue = products.reduce(
      (sum, product) =>
        sum + Number(product.stock ?? product.quantity ?? 0) * Number(product.price || 0),
      0
    );

    const warehouseInventoryValue = inventory.reduce((sum, item) => {
      const product = productMap.get(String(item.productId || item.product || ""));
      const price = Number(product?.price || 0);
      const stock = Number(item.stock || 0);
      return sum + stock * price;
    }, 0);

    const totalStock =
      products.reduce(
        (sum, product) => sum + Number(product.stock ?? product.quantity ?? 0),
        0
      ) +
      inventory.reduce((sum, item) => sum + Number(item.stock || 0), 0);

    const inventoryValue = holdingValue + warehouseInventoryValue;

    const inventoryStatus = products.reduce(
      (totals, product) => {
        const stock = Number(product.quantity ?? product.stock ?? 0);
        if (stock === 0) totals.outOfStock += 1;
        else if (stock <= 20) totals.lowStock += 1;
        else if (stock > 100) totals.overstock += 1;
        else totals.inStock += 1;
        return totals;
      },
      { inStock: 0, lowStock: 0, outOfStock: 0, overstock: 0 }
    );

    const months = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - index));
      return {
        label: date.toLocaleDateString("en-US", { month: "short" }),
        month: date.getMonth(),
        year: date.getFullYear(),
        sales: 0,
      };
    });

    orders
      .filter((order) => order.status !== "Cancelled")
      .forEach((order) => {
        const dateValue = order.createdAt || order.updatedAt;
        if (!dateValue) return;
        const date = new Date(dateValue);
        if (Number.isNaN(date.getTime())) return;
        const month = months.find(
          (item) => item.month === date.getMonth() && item.year === date.getFullYear()
        );
        if (month) month.sales += Number(order.totalAmount || order.finalAmount || 0);
      });

    const latestOrders = [...orders]
      .sort(
        (left, right) =>
          new Date(right.createdAt || right.updatedAt || 0) -
          new Date(left.createdAt || left.updatedAt || 0)
      )
      .slice(0, 5);

    const warehouseSummary = warehouses.map((warehouse) => {
      const warehouseId = String(warehouse._id || warehouse.id || "");
      const warehouseInventory = inventory.filter(
        (item) => String(item.warehouseId || item.warehouse || "") === warehouseId
      );
      const usedStock = warehouseInventory.reduce((sum, item) => {
        const product = productMap.get(String(item.productId || item.product || ""));
        const stock = Number(item.stock || 0);
        return sum + toKg(stock, product?.unit || item.unit || "KG");
      }, 0);
      const capacity = Number(warehouse.capacity || 0);
      const utilization = capacity ? (usedStock / capacity) * 100 : 0;

      return {
        ...warehouse,
        totalStock: usedStock,
        utilization: Number.isFinite(utilization) ? Number(utilization.toFixed(2)) : 0,
      };
    });

    const monthRange = (dateValue, targetMonthIndex) => {
      const date = new Date(dateValue);
      if (Number.isNaN(date.getTime())) return false;
      const current = new Date();
      const target = new Date(current);
      target.setMonth(current.getMonth() - targetMonthIndex);
      target.setDate(1);
      target.setHours(0, 0, 0, 0);
      const end = new Date(target);
      end.setMonth(end.getMonth() + 1);
      return date >= target && date < end;
    };

    const currentMonthProducts = products.filter((product) =>
      monthRange(product.createdAt, 0)
    ).length;
    const previousMonthProducts = products.filter((product) =>
      monthRange(product.createdAt, 1)
    ).length;
    const currentMonthOrders = orders.filter((order) => monthRange(order.createdAt, 0)).length;
    const previousMonthOrders = orders.filter((order) => monthRange(order.createdAt, 1)).length;
    const currentMonthWarehouses = warehouses.filter((warehouse) =>
      monthRange(warehouse.createdAt, 0)
    ).length;
    const previousMonthWarehouses = warehouses.filter((warehouse) =>
      monthRange(warehouse.createdAt, 1)
    ).length;
    const currentMonthInventoryValue = products
      .filter((product) => monthRange(product.createdAt, 0))
      .reduce(
        (sum, product) =>
          sum + Number(product.quantity ?? product.stock ?? 0) * Number(product.price || 0),
        0
      );
    const previousMonthInventoryValue = products
      .filter((product) => monthRange(product.createdAt, 1))
      .reduce(
        (sum, product) =>
          sum + Number(product.quantity ?? product.stock ?? 0) * Number(product.price || 0),
        0
      );

    const calculateGrowth = (current, previous) => {
      if (!previous) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    return {
      totalStock,
      inventoryValue,
      inventoryStatus,
      months,
      latestOrders,
      warehouseSummary,
      metrics: [
        {
          label: "Total Products",
          value: products.length.toLocaleString(),
          growth: calculateGrowth(currentMonthProducts, previousMonthProducts),
          detail: "vs last month",
          icon: FaBoxOpen,
          tone: "blue",
        },
        {
          label: "Total Warehouses",
          value: warehouses.length.toLocaleString(),
          growth: calculateGrowth(currentMonthWarehouses, previousMonthWarehouses),
          detail: "vs last month",
          icon: FaWarehouse,
          tone: "purple",
        },
        {
          label: "Total Orders",
          value: orders.length.toLocaleString(),
          growth: calculateGrowth(currentMonthOrders, previousMonthOrders),
          detail: "vs last month",
          icon: FaClipboardList,
          tone: "orange",
        },
        {
          label: "Inventory Value",
          value: currencyFormatter.format(inventoryValue),
          growth: calculateGrowth(
            currentMonthInventoryValue,
            previousMonthInventoryValue
          ),
          detail: "vs last month",
          icon: FaRupeeSign,
          tone: "green",
        },
      ],
    };
  }, [dashboard]);

  return (
    <div className="dashboard-shell">
      <Sidebar />

      <div className="dashboard-content">
        <div className="dashboard-page">
          <DashboardHeader
            title="Admin Dashboard"
            subtitle="Operations overview"
          />

          <div className="dashboard-hero">
            <div className="dashboard-hero__copy">
              <p className="dashboard-eyebrow">Live overview</p>
              <h2>Supply chain visibility at a glance</h2>
              <p>
                Monitor inventory, orders, warehouse health, and AI demand
                signals from one place.
              </p>
            </div>
            <div className="dashboard-hero__meta">
              <span className="dashboard-pill">
                <FaChartLine /> Live insights
              </span>
              <span className="dashboard-pill dashboard-pill--soft">
                <FaBoxes /> {dashboard.products.length} products tracked
              </span>
            </div>
          </div>

          {loading && (
            <div className="dashboard-loading">
              Loading live dashboard data…
            </div>
          )}

          <div className="stats-grid">
            {computed.metrics.map((metric) => (
              <StatsCard
                key={metric.label}
                icon={metric.icon}
                label={metric.label}
                value={metric.value}
                growth={metric.growth}
                detail={metric.detail}
                tone={metric.tone}
              />
            ))}
          </div>

          <div className="chart-section">
            <SalesChart data={computed.months} />
            <InventoryChart
              status={computed.inventoryStatus}
              total={computed.totalStock}
            />
            <RecentOrders
              orders={computed.latestOrders}
              warehouses={dashboard.warehouses}
            />
          </div>

          <div className="table-section">
            <PredictionTable
              predictions={dashboard.predictions.slice(0, 6)}
              products={dashboard.products}
            />
            <WarehouseTable warehouses={computed.warehouseSummary} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminHome;