import { useCallback, useEffect,useState } from "react";

import { useNavigate,useParams } from "react-router-dom";

import {

    getAdminOrder,

    updateOrderStatus

} from "../../../services/orderService";

import { getSuppliers } from "../../../services/supplierService";
import { getBackendAssetUrl } from "../../../services/api";

import OrderStatus from "./OrderStatus";

import "../../../assets/css/orderDetails.css";

const getAllowedNextStatuses = (currentStatus) => {

    const transitions = {

        Placed: ["Confirmed", "Cancelled"],

        Confirmed: ["Packed"],

        Packed: ["Shipped"],

        Shipped: ["Delivered"],

        Delivered: [],

        Cancelled: []

    };

    return transitions[currentStatus] || [];

};

function OrderDetails(){

    const {id}=useParams();

    const navigate=useNavigate();

    const [order,setOrder]=useState(null);

    const [loading,setLoading]=useState(true);

    const [statusLoading,setStatusLoading]=useState(false);

    const [suppliers,setSuppliers]=useState([]);

    const [selectedSupplierId,setSelectedSupplierId]=useState("");

    const [feedback,setFeedback]=useState({type:"",message:""});

    const loadOrder = useCallback(async () => {

        const response=await getAdminOrder(id);

        setOrder(response.order);

        setSelectedSupplierId(response.order?.allocatedSupplier?._id || response.order?.allocatedSupplier || "");

        setLoading(false);

    }, [id]);

    useEffect(() => {
        let active = true;
        getAdminOrder(id)
            .then((response) => {
                if (!active) return;
                setOrder(response.order);
                setSelectedSupplierId(
                    response.order?.allocatedSupplier?._id
                    || response.order?.allocatedSupplier
                    || ""
                );
                setLoading(false);
            })
            .catch((error) => console.error(error));
        getSuppliers()
            .then((response) => {
                if (active) setSuppliers(response.supplier || []);
            })
            .catch((error) => console.error(error));

        return () => {
            active = false;
        };
    }, [id]);

    const changeStatus=async(status)=>{

        if (status === "Shipped" && !selectedSupplierId) {

            setFeedback({

                type:"error",

                message:"Please allocate a supplier before shipping the order."

            });

            return;

        }

        setStatusLoading(true);

        setFeedback({type:"",message:""});

        try{

            await updateOrderStatus(

                order._id,

                status,

                status === "Shipped" ? selectedSupplierId : null

            );

            await loadOrder();

            setFeedback({

                type:"success",

                message:"Status Updated"

            });

        }

        catch(error){

            setFeedback({

                type:"error",

                message:error.response?.data?.message || error.message || "Unable to update order status"

            });

        }

        finally{

            setStatusLoading(false);

        }

    };

    if(loading){

        return <h2>Loading...</h2>;

    }

    return(

        <div className="order-details-container">

            <button

                className="back-btn"

                onClick={()=>navigate(-1)}

            >

                Back

            </button>

            <h2>

                Admin Order Details

            </h2>

            <div className="order-info">

                <p>

                    <b>Customer :</b>

                    {order.userId?.name}

                </p>

                <p>

                    <b>Email :</b>

                    {order.userId?.email}

                </p>

                <p>

                    <b>Warehouse :</b>

                    {order.warehouseId?.name}

                </p>

                <p>

                    <b>Total :</b>

                    ₹{order.totalAmount}

                </p>

                <OrderStatus

                    status={order.status}

                    onChange={changeStatus}

                    availableStatuses={getAllowedNextStatuses(order.status)}

                    loading={statusLoading}

                />

                {feedback.message ? (

                    <p className={`feedback-message ${feedback.type}`}>

                        {feedback.message}

                    </p>

                ) : null}

                {order.status === "Packed" ? (

                    <div className="supplier-allocation-panel">

                        <label className="supplier-allocation-label">

                            Allocate Supplier

                        </label>

                        <select

                            className="supplier-select"

                            value={selectedSupplierId}

                            onChange={(e) => setSelectedSupplierId(e.target.value)}

                        >

                            <option value="">

                                Select a supplier

                            </option>

                            {suppliers.map((supplier) => {

                                const capacity = Number(supplier.currentAssignedWeight || 0);

                                const maxCapacity = Number(supplier.supplierCapacity || 0);

                                const remaining = maxCapacity - capacity;

                                const isFull = remaining <= 0;

                                return (

                                    <option key={supplier._id} value={supplier._id} disabled={isFull}>

                                        {supplier.supplierName} - {supplier.supplierVehiclenumber} - Remaining {remaining} KG{isFull ? " (Full)" : ""}

                                    </option>

                                );

                            })}

                        </select>

                        <p className="supplier-allocation-note">

                            Select a supplier before changing this order to Shipped.

                        </p>

                    </div>

                ) : null}

            </div>

            <hr/>

            {

                order.items.map(item=>(

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

                                Qty :

                                {item.quantity}

                            </p>

                            <p>

                                Price :

                                ₹{item.price}

                            </p>

                            <p>

                                Subtotal :

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