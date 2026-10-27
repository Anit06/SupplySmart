import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { getOrders } from "../../../services/orderService";
import { getBackendAssetUrl } from "../../../services/api";

import "../../../assets/css/orderHistory.css";

const PAGE_SIZE = 10;

function OrderHistory() {
    const navigate = useNavigate();

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        let active = true;
        getOrders()
            .then((response) => {
                if (active) setOrders(response.orders || []);
            })
            .catch((error) => console.log(error))
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, []);

    // Pagination Logic
    const totalPages = Math.ceil(orders.length / PAGE_SIZE) || 1;

    const paginatedOrders = useMemo(() => {
        const startIndex = (currentPage - 1) * PAGE_SIZE;
        return orders.slice(startIndex, startIndex + PAGE_SIZE);
    }, [orders, currentPage]);

    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    if (loading) {
        return <h2>Loading...</h2>;
    }

    return (
        <div className="order-history">
            <h2>My Orders</h2>

            {orders.length === 0 ? (
                <div className="empty-orders">
                    <h3>No Orders Found</h3>
                    <p>You haven't placed any order yet.</p>
                </div>
            ) : (
                <>
                    {paginatedOrders.map((order) => (
                        <div className="order-card" key={order._id}>
                            <div className="order-header">
                                <div>
                                    <h3>Order #{order._id.slice(-6)}</h3>
                                    <small>
                                        {new Date(order.createdAt).toLocaleString()}
                                    </small>
                                </div>

                                <span
                                    className={`status ${order.status.toLowerCase()}`}
                                >
                                    {order.status}
                                </span>
                            </div>

                            <hr />

                            <p>
                                <strong>Warehouse :</strong> {order.warehouseId?.name}
                            </p>

                            <p>
                                <strong>Total Items :</strong>{" "}
                                {order.items.reduce(
                                    (sum, item) => sum + item.quantity,
                                    0
                                )}
                            </p>

                            {order.items.map((item) => (
                                <div key={item._id} className="order-item">
                                    <img
                                        src={getBackendAssetUrl(item.image)}
                                        alt={item.productName}
                                    />

                                    <div className="item-details">
                                        <h4>{item.productName}</h4>
                                        <p>Qty : {item.quantity}</p>
                                        <p>Price : ₹{item.price}</p>
                                    </div>

                                    <div>₹{item.subtotal}</div>
                                </div>
                            ))}

                            <hr />

                            <div className="order-footer">
                                <h3>Total ₹{order.totalAmount}</h3>

                                <button
                                    className="track-order-btn"
                                    onClick={() =>
                                        navigate(`/shopkeeper/order/${order._id}/track`)
                                    }
                                >
                                    Track Order
                                </button>
                            </div>
                        </div>
                    ))}

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div className="pagination-container">
                            <button
                                className="pagination-btn"
                                onClick={() => handlePageChange(currentPage - 1)}
                                disabled={currentPage === 1}
                            >
                                &laquo; Prev
                            </button>

                            <div className="pagination-numbers">
                                {Array.from({ length: totalPages }, (_, index) => {
                                    const pageNum = index + 1;
                                    return (
                                        <button
                                            key={pageNum}
                                            className={`page-num ${currentPage === pageNum ? "active" : ""
                                                }`}
                                            onClick={() => handlePageChange(pageNum)}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                            </div>

                            <button
                                className="pagination-btn"
                                onClick={() => handlePageChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                            >
                                Next &raquo;
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export default OrderHistory;