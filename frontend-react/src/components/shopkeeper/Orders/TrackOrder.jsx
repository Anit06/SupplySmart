import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getOrder } from "../../../services/orderService";
import { getBackendAssetUrl } from "../../../services/api";

import "../../../assets/css/trackOrder.css";

function TrackOrder() {

    const { id } = useParams();

    const navigate = useNavigate();

    const [order, setOrder] = useState(null);

    const [loading, setLoading] = useState(true);

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

        return <h2>Order Not Found</h2>;

    }

    const statuses = [

        "Placed",

        "Confirmed",

        "Packed",

        "Shipped",

        "Delivered",

        "Cancelled"

    ];

    const getHistory = (status) => {

        return order.statusHistory.find(

            item => item.status === status

        );

    };

    return (

        <div className="track-container">

            <button

                className="back-btn"

                onClick={() => navigate(-1)}

            >

                ← Back

            </button>

            <div className="track-header">

                <h2>

                    Track Order

                </h2>

                <span className="current-status">

                    {order.status}

                </span>

            </div>

            <div className="order-summary">

                <div>

                    <strong>Order Number</strong>

                    <p>{order.orderNumber}</p>

                </div>

                <div>

                    <strong>Warehouse</strong>

                    <p>{order.warehouseId?.name}</p>

                </div>

                <div>

                    <strong>Date</strong>

                    <p>

                        {

                            new Date(

                                order.createdAt

                            ).toLocaleString()

                        }

                    </p>

                </div>

                <div>

                    <strong>Total</strong>

                    <p>

                        ₹{order.totalAmount}

                    </p>

                </div>

            </div>

            <div className="timeline-card">

                <h3>

                    Order Timeline

                </h3>

                {

                    statuses.map(status => {

                        const history = getHistory(status);

                        return (

                            <div

                                key={status}

                                className="timeline-row"

                            >

                                <div

                                    className={

                                        history

                                            ?

                                            "circle active"

                                            :

                                            "circle"

                                    }

                                >

                                    {

                                        history

                                            ?

                                            "✓"

                                            :

                                            ""

                                    }

                                </div>

                                <div className="timeline-info">

                                    <h4>

                                        {status}

                                    </h4>

                                    <p>

                                        {

                                            history

                                                ?

                                                new Date(

                                                    history.updatedAt

                                                ).toLocaleString()

                                                :

                                                "Pending"

                                        }

                                    </p>

                                </div>

                            </div>

                        );

                    })

                }

            </div>

            <div className="products-card">

                <h3>

                    Ordered Products

                </h3>

                {

                    order.items.map(item => (

                        <div

                            key={item._id}

                            className="product-row"

                        >

                            <img

                                src={getBackendAssetUrl(item.image)}

                                alt={item.productName}

                            />

                            <div className="product-info">

                                <h4>

                                    {item.productName}

                                </h4>

                                <p>

                                    Qty : {item.quantity}

                                </p>

                                <p>

                                    Price : ₹{item.price}

                                </p>

                            </div>

                            <div className="subtotal">

                                ₹{item.subtotal}

                            </div>

                        </div>

                    ))

                }

            </div>

        </div>

    );

}

export default TrackOrder;