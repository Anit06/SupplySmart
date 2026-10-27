function RecentOrders({ orders, warehouses = [] }) {
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse._id || warehouse.id, warehouse]));

  return (
    <section className="dashboard-card dashboard-orders-card">
      <div className="dashboard-card__heading">
        <div>
          <p>Latest activity</p>
          <h2>Recent Orders</h2>
        </div>
        <a href="/admin/orders">View all</a>
      </div>

      {orders.length ? (
        <div className="dashboard-order-list">
          {orders.map((order) => {
            const warehouse = warehouseById.get(order.warehouseId) || {};
            const orderNumber = order.orderNumber || order._id?.slice(-6) || "—";
            const customerName = order.shopkeeperName || order.customerName || "Guest";
            const warehouseName = warehouse.name || order.warehouseName || "Warehouse";
            const orderDateValue = order.createdAt || order.updatedAt;
            const orderDate = orderDateValue ? new Date(orderDateValue) : null;
            const statusClass = `dashboard-badge dashboard-badge--${String(order.status || "Placed").toLowerCase()}`;

            return (
              <div className="dashboard-order" key={order._id || orderNumber}>
                <div className="dashboard-order__details">
                  <strong>#{orderNumber}</strong>
                  <span>{customerName}</span>
                  <small>{warehouseName}</small>
                </div>
                <div className="dashboard-order__meta">
                  <b>₹{Number(order.totalAmount || order.finalAmount || 0).toLocaleString("en-IN")}</b>
                  <em className={statusClass}>{order.status || "Placed"}</em>
                  <small>
                    {orderDate && !Number.isNaN(orderDate.getTime())
                      ? orderDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                      : "—"}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dashboard-empty-state">No recent orders to display.</div>
      )}
    </section>
  );
}

export default RecentOrders;