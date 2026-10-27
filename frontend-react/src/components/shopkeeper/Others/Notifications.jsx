import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaBell,
  FaCheckDouble,
  FaShoppingBag,
  FaTruck,
  FaBoxOpen,
  FaTimesCircle,
  FaCheckCircle,
  FaArrowLeft,
  FaTrashAlt,
  FaChevronLeft,
  FaChevronRight
} from "react-icons/fa";
import { getOrders } from "../../../services/orderService";
import "../../../assets/css/notifications.css";

const PAGE_SIZE = 10;

const formatDate = (date) => {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
};

const getNotificationIcon = (status = "") => {
  switch (status.toLowerCase()) {
    case "placed":
    case "confirmed":
      return <FaShoppingBag className="icon-placed" />;
    case "packed":
      return <FaBoxOpen className="icon-packed" />;
    case "shipped":
      return <FaTruck className="icon-shipped" />;
    case "delivered":
      return <FaCheckCircle className="icon-delivered" />;
    case "cancelled":
      return <FaTimesCircle className="icon-cancelled" />;
    default:
      return <FaBell className="icon-default" />;
  }
};

function Notifications() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all"); // 'all' | 'unread' | 'delivered'
  const [currentPage, setCurrentPage] = useState(1);
  const [readIds, setReadIds] = useState(() => {
    const saved = localStorage.getItem("read_notifications");
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        setLoading(true);
        setError("");
        const res = await getOrders();
        setOrders(res.orders || []);
      } catch (err) {
        console.error(err);
        setError("Failed to load notifications. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchNotifications();
  }, []);

  // Persist read state in localStorage
  useEffect(() => {
    localStorage.setItem("read_notifications", JSON.stringify(readIds));
  }, [readIds]);

  const changeFilter = (nextFilter) => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  // Expand status history of all orders into individual notification items
  const notificationsList = useMemo(() => {
    const items = [];

    orders.forEach((order) => {
      const orderNum = order.orderNumber || `#${order._id?.slice(-6)}`;

      if (order.statusHistory && order.statusHistory.length > 0) {
        order.statusHistory.forEach((history, idx) => {
          items.push({
            id: `${order._id}-${history.status}-${idx}`,
            orderId: order._id,
            orderNumber: orderNum,
            status: history.status,
            message: `Order ${orderNum} status changed to ${history.status.toLowerCase()}.`,
            timestamp: history.updatedAt || order.updatedAt || order.createdAt,
            totalAmount: order.totalAmount
          });
        });
      } else {
        items.push({
          id: `${order._id}-${order.status}`,
          orderId: order._id,
          orderNumber: orderNum,
          status: order.status || "Placed",
          message: `Order ${orderNum} is currently ${order.status?.toLowerCase() || "updated"}.`,
          timestamp: order.updatedAt || order.createdAt,
          totalAmount: order.totalAmount
        });
      }
    });

    // Sort by newest first
    return items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [orders]);

  const filteredNotifications = useMemo(() => {
    return notificationsList.filter((item) => {
      const isRead = readIds.includes(item.id);
      if (filter === "unread") return !isRead;
      if (filter === "delivered") return item.status?.toLowerCase() === "delivered";
      return true;
    });
  }, [notificationsList, filter, readIds]);

  // Calculate pagination boundaries
  const totalPages = Math.ceil(filteredNotifications.length / PAGE_SIZE) || 1;

  const paginatedNotifications = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredNotifications.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredNotifications, currentPage]);

  const markAllAsRead = () => {
    const allIds = notificationsList.map((n) => n.id);
    setReadIds(allIds);
  };

  const toggleRead = (id, e) => {
    e.stopPropagation();
    setReadIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleNotificationClick = (item) => {
    if (!readIds.includes(item.id)) {
      setReadIds((prev) => [...prev, item.id]);
    }
    navigate(`/shopkeeper/order/${item.orderId}`);
  };

  const clearAllNotifications = () => {
    if (window.confirm("Are you sure you want to mark all notifications as cleared?")) {
      markAllAsRead();
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="notifications-page">
      {/* Top Header */}
      <header className="notifications-header">
        <div className="header-title-group">
          <button className="back-btn" type="button" onClick={() => navigate(-1)} aria-label="Go back">
            <FaArrowLeft />
          </button>
          <div>
            <p className="eyebrow">Updates & Alerts</p>
            <h1>Notifications</h1>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="secondary-btn"
            type="button"
            onClick={markAllAsRead}
            disabled={!notificationsList.some((n) => !readIds.includes(n.id))}
          >
            <FaCheckDouble /> Mark all as read
          </button>
          <button
            className="danger-btn"
            type="button"
            onClick={clearAllNotifications}
            disabled={notificationsList.length === 0}
          >
            <FaTrashAlt /> Clear view
          </button>
        </div>
      </header>

      {/* Filter Tabs */}
      <div className="notifications-filters">
        <div className="filter-tabs">
          <button
            className={`tab ${filter === "all" ? "active" : ""}`}
            onClick={() => changeFilter("all")}
            type="button"
          >
            All ({notificationsList.length})
          </button>
          <button
            className={`tab ${filter === "unread" ? "active" : ""}`}
            onClick={() => changeFilter("unread")}
            type="button"
          >
            Unread ({notificationsList.filter((n) => !readIds.includes(n.id)).length})
          </button>
          <button
            className={`tab ${filter === "delivered" ? "active" : ""}`}
            onClick={() => changeFilter("delivered")}
            type="button"
          >
            Delivered
          </button>
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="notifications-state">Loading notifications...</div>
      ) : error ? (
        <div className="notifications-state error">{error}</div>
      ) : filteredNotifications.length === 0 ? (
        <div className="notifications-state empty">
          <FaBell className="empty-icon" />
          <h3>No notifications found</h3>
          <p>When there are updates regarding your orders, they will appear here.</p>
        </div>
      ) : (
        <>
          <div className="notifications-list">
            {paginatedNotifications.map((item) => {
              const isRead = readIds.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`notification-card ${isRead ? "read" : "unread"}`}
                  onClick={() => handleNotificationClick(item)}
                >
                  <div className="notification-icon-wrap">
                    {getNotificationIcon(item.status)}
                  </div>

                  <div className="notification-content">
                    <div className="notification-top">
                      <h4>{item.message}</h4>
                      <span className="timestamp">{formatDate(item.timestamp)}</span>
                    </div>
                    <div className="notification-meta">
                      <span className={`status-badge status-${item.status?.toLowerCase()}`}>
                        {item.status}
                      </span>
                      {item.totalAmount && (
                        <span className="amount-badge">₹{item.totalAmount}</span>
                      )}
                    </div>
                  </div>

                  <div className="notification-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`mark-read-dot ${isRead ? "is-read" : ""}`}
                      type="button"
                      title={isRead ? "Mark as unread" : "Mark as read"}
                      onClick={(e) => toggleRead(item.id, e)}
                    >
                      <span className="dot" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="pagination-container">
              <button
                className="pagination-btn"
                type="button"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                aria-label="Previous Page"
              >
                <FaChevronLeft /> Prev
              </button>

              <div className="pagination-numbers">
                {Array.from({ length: totalPages }, (_, index) => {
                  const pageNum = index + 1;
                  return (
                    <button
                      key={pageNum}
                      type="button"
                      className={`page-num ${currentPage === pageNum ? "active" : ""}`}
                      onClick={() => handlePageChange(pageNum)}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              <button
                className="pagination-btn"
                type="button"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                aria-label="Next Page"
              >
                Next <FaChevronRight />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default Notifications;