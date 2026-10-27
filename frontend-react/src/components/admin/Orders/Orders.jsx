import { useEffect, useState } from "react";
import Sidebar from "../../common/Sidebar";
import { getAllOrders, getOrderAnalytics } from "../../../services/orderService";
import AnalyticsCards from "./AnalyticsCards";
import OrderList from "./OrderList";

import "../../../assets/css/order.css";

function Orders() {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [analytics, setAnalytics] = useState(null);

    // --- Pagination State ---
    const [currentPage, setCurrentPage] = useState(1);
    const ordersPerPage = 10;

    useEffect(() => {
        loadOrders();
    }, []);

    async function loadOrders() {
        try {
            const [orderResponse, analyticsResponse] = await Promise.all([
                getAllOrders(),
                getOrderAnalytics()
            ]);

            setOrders(orderResponse.orders || []);
            setAnalytics(analyticsResponse.analytics);
        } catch (error) {
            console.log(error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <h2>Loading...</h2>;
    }

    // --- Pagination Calculation ---
    const indexOfLastOrder = currentPage * ordersPerPage;
    const indexOfFirstOrder = indexOfLastOrder - ordersPerPage;
    const currentOrders = orders.slice(indexOfFirstOrder, indexOfLastOrder);
    const totalPages = Math.ceil(orders.length / ordersPerPage);

    const handlePageChange = (pageNumber) => {
        setCurrentPage(pageNumber);
    };

    return (
        <div className="order-layout">
            <Sidebar />

            <div className="catalog-container">
                <h2>Order Dashboard</h2>

                <AnalyticsCards analytics={analytics} />

                {/* Pass current 10 sliced orders */}
                <OrderList
                    orders={currentOrders}
                    reload={loadOrders}
                />

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="pagination-container">
                        <button
                            className="pagination-btn"
                            disabled={currentPage === 1}
                            onClick={() => handlePageChange(currentPage - 1)}
                        >
                            &laquo; Prev
                        </button>

                        <div className="pagination-numbers">
                            {Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => (
                                <button
                                    key={number}
                                    className={`pagination-number ${currentPage === number ? "active" : ""}`}
                                    onClick={() => handlePageChange(number)}
                                >
                                    {number}
                                </button>
                            ))}
                        </div>

                        <button
                            className="pagination-btn"
                            disabled={currentPage === totalPages}
                            onClick={() => handlePageChange(currentPage + 1)}
                        >
                            Next &raquo;
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Orders;