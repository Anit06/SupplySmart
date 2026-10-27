import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { getOrder } from "../../../services/orderService";
import { getBackendAssetUrl } from "../../../services/api";

import "../../../assets/css/orderDetails.css";

function OrderDetails() {

    const { id } = useParams();

    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);

    const [order, setOrder] = useState(null);

    useEffect(() => {
        let active = true;
        getOrder(id)
            .then((response) => {
                if (active) setOrder(response.order);
            })
            .catch((error) => console.log(error))
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [id]);

    if (loading) {

        return <h2>Loading...</h2>;

    }

    if (!order) {

        return <h2>Order not found</h2>;

    }

    return (

        <div className="order-details-container">

            <button
                className="back-btn"
                onClick={() => navigate(-1)}
            >
                ← Back
            </button>

            <h2>Order Details</h2>

            <div className="order-info">

                <p>

                    <strong>Order ID :</strong>

                    {order._id}

                </p>

                <p>

                    <strong>Status :</strong>

                    {order.status}

                </p>

                <p>

                    <strong>Date :</strong>

                    {new Date(order.createdAt).toLocaleString()}

                </p>

                <p>

                    <strong>Total :</strong>

                    ₹{order.totalAmount}

                </p>

            </div>

            <hr />

            {

                order.items.map(item => (

                    <div
                        key={item._id}
                        className="detail-item"
                    >

                        <img
                            src={getBackendAssetUrl(item.image)}
                            alt={item.productName}
                        />

                        <div className="detail-content">

                            <h3>

                                {item.productName}

                            </h3>

                            <p>

                                <strong>SKU :</strong>

                                {item.sku}

                            </p>

                            <p>

                                <strong>Category :</strong>

                                {item.category}

                            </p>

                            <p>

                                <strong>Unit :</strong>

                                {item.unit}

                            </p>

                            <p>

                                <strong>Price :</strong>

                                ₹{item.price}

                            </p>

                            <p>

                                <strong>Quantity :</strong>

                                {item.quantity}

                            </p>

                            <p>

                                <strong>Subtotal :</strong>

                                ₹{item.subtotal}

                            </p>

                        </div>

                    </div>

                ))

            }

        </div>

    );

}

export default OrderDetails;