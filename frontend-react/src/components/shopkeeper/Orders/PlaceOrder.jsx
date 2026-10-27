import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
    getCart,
    placeOrder
} from "../../../services/cartService";
import { createOrder as createRazorpayOrder, verifyPayment } from "../../../services/paymentService";

import { getWarehouseById } from "../../../services/warehouseService";
import { getProfile } from "../../../services/shopkeeperService";

import "../../../assets/css/placeOrder.css";

const availableCoupons = {
    SAVE10: {
        type: "percent",
        value: 10,
        label: "10% off"
    },
    FLAT100: {
        type: "flat",
        value: 100,
        minAmount: 1000,
        label: "₹100 off"
    }
};

const formatAddress = (address) => {
    if (!address) return "";

    return [
        address.fullName,
        address.addressLine1,
        address.addressLine2,
        address.city,
        address.state,
        address.pincode
    ]
        .filter(Boolean)
        .join(", ");
};

const loadRazorpay = () => new Promise((resolve, reject) => {
    if (window.Razorpay) {
        resolve();
        return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay Checkout."));
    document.body.appendChild(script);
});

function PlaceOrder() {
    const navigate = useNavigate();

    const [warehouse, setWarehouse] = useState(null);
    const [cart, setCart] = useState({ items: [], cartTotal: 0 });
    const [addresses, setAddresses] = useState([]);
    const [selectedAddressId, setSelectedAddressId] = useState("");
    const [showAddressList, setShowAddressList] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState("Cash On Delivery");
    const [couponCode, setCouponCode] = useState("");
    const [appliedCoupon, setAppliedCoupon] = useState(null);
    const [couponMessage, setCouponMessage] = useState("");
    const [discountAmount, setDiscountAmount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [placingOrder, setPlacingOrder] = useState(false);
    const submissionInProgress = useRef(false);

    const originalTotal = cart.cartTotal || 0;
    const taxableAmount = Math.max(originalTotal - discountAmount, 0);
    const gstAmount = useMemo(() => Math.round(taxableAmount * 0.18), [taxableAmount]);
    const finalAmount = taxableAmount + gstAmount;

    useEffect(() => {
        const warehouseId = localStorage.getItem("selectedWarehouse");
        if (!warehouseId) {
            navigate("/shopkeeper/cart");
            return;
        }
        let active = true;

        Promise.all([
            getWarehouseById(warehouseId),
            getCart(warehouseId)
        ])
            .then(([warehouseResp, cartResp]) => {
                if (!active) return;
                setWarehouse(warehouseResp.warehouse || warehouseResp);
                setCart(cartResp.cart || { items: [], cartTotal: 0 });

                const user = JSON.parse(localStorage.getItem("user") || "{}") || {};
                if (!user.id) return null;
                return getProfile(user.id);
            })
            .then((profileResp) => {
                if (!active || !profileResp) return;
                const savedAddresses = profileResp.data.profile.addresses || [];
                setAddresses(savedAddresses);
                if (savedAddresses.length > 0) {
                    const defaultAddress =
                        savedAddresses.find((item) => item.isDefault) || savedAddresses[0];
                    setSelectedAddressId(defaultAddress._id);
                }
            })
            .catch((error) => console.error(error))
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [navigate]);

    const currentAddress = addresses.find((address) => address._id === selectedAddressId) || addresses[0] || null;

    const validateCoupon = (code, amount) => {
        const normalized = (code || "").trim().toUpperCase();

        if (!normalized) {
            return {
                valid: false,
                message: "Enter a coupon code"
            };
        }

        const coupon = availableCoupons[normalized];

        if (!coupon) {
            return {
                valid: false,
                message: "Invalid coupon code"
            };
        }

        if (coupon.type === "percent") {
            return {
                valid: true,
                amount: Math.round((amount * coupon.value) / 100),
                code: normalized,
                label: coupon.label,
                message: `${coupon.label} applied successfully`
            };
        }

        if (coupon.type === "flat") {
            if (amount < coupon.minAmount) {
                return {
                    valid: false,
                    message: `Minimum order value ₹${coupon.minAmount} required for this coupon`
                };
            }

            return {
                valid: true,
                amount: coupon.value,
                code: normalized,
                label: coupon.label,
                message: `${coupon.label} applied successfully`
            };
        }

        return {
            valid: false,
            message: "Invalid coupon code"
        };
    };

    const handleApplyCoupon = () => {
        const result = validateCoupon(couponCode, cart.cartTotal);

        if (!result.valid) {
            setAppliedCoupon(null);
            setDiscountAmount(0);
            setCouponMessage(result.message);
            return;
        }

        setAppliedCoupon(result);
        setDiscountAmount(result.amount);
        setCouponMessage(result.message);
    };

    const handlePlaceOrder = async () => {
        if (submissionInProgress.current) return;
        if (!cart.items.length) {
            alert("Your cart is empty.");
            return;
        }

        if (!currentAddress) {
            alert("Please select a saved delivery address or add one from Addresses.");
            return;
        }

        submissionInProgress.current = true;
        try {
            setPlacingOrder(true);
            const warehouseId = localStorage.getItem("selectedWarehouse");
            const storageKey = `pendingCheckout:${warehouseId}`;
            let checkoutId = sessionStorage.getItem(storageKey);
            if (!checkoutId) {
                checkoutId = window.crypto.randomUUID();
                sessionStorage.setItem(storageKey, checkoutId);
            }

            const response = await placeOrder({
                warehouseId,
                checkoutId,
                paymentMethod,
                couponCode: appliedCoupon?.code || "",
                discountAmount,
                subtotal: cart.cartTotal,
                taxAmount: gstAmount,
                finalAmount,
                addressId: currentAddress._id
            });

            const order = response.order;
            if (!order?._id) {
                throw new Error("The server did not return the created order.");
            }

            if (paymentMethod === "Cash On Delivery") {
                alert(response.message || "Order placed successfully");
                sessionStorage.removeItem(storageKey);
                localStorage.removeItem("selectedWarehouse");
                navigate("/shopkeeper/order-history");
                return;
            }

            const paymentAttemptKey = `paymentAttempt:${order._id}`;
            let paymentAttemptId = sessionStorage.getItem(paymentAttemptKey);
            if (!paymentAttemptId) {
                paymentAttemptId = window.crypto.randomUUID();
                sessionStorage.setItem(paymentAttemptKey, paymentAttemptId);
            }

            let paymentOrder;
            try {
                paymentOrder = await createRazorpayOrder(order._id, paymentAttemptId);
            } catch (error) {
                if (error.response?.data?.code !== "PAYMENT_ATTEMPT_FAILED") {
                    throw error;
                }
                paymentAttemptId = window.crypto.randomUUID();
                sessionStorage.setItem(paymentAttemptKey, paymentAttemptId);
                paymentOrder = await createRazorpayOrder(order._id, paymentAttemptId);
            }
            if (
                typeof paymentOrder?.order?.id !== "string"
                || !paymentOrder.order.id
                || typeof paymentOrder.order.keyId !== "string"
                || !Number.isSafeInteger(paymentOrder.order.amount)
                || paymentOrder.order.amount < 1
                || paymentOrder.order.currency !== "INR"
            ) {
                throw new Error("The payment provider order is not ready. Your existing attempt is protected; try again shortly.");
            }
            await loadRazorpay();

            const checkout = new window.Razorpay({
                key: paymentOrder.order.keyId,
                amount: paymentOrder.order.amount,
                currency: paymentOrder.order.currency,
                name: "AI Supply Chain Management",
                description: `Payment for order ${order.orderNumber}`,
                order_id: paymentOrder.order.id,
                prefill: {
                    name: order.shopkeeperName,
                    contact: order.shopkeeperPhone
                },
                handler: async (providerResponse) => {
                    try {
                        const verification = await verifyPayment({
                            orderId: order._id,
                            razorpay_order_id: providerResponse.razorpay_order_id,
                            razorpay_payment_id: providerResponse.razorpay_payment_id,
                            razorpay_signature: providerResponse.razorpay_signature
                        });
                        if (verification.paid) {
                            sessionStorage.removeItem(storageKey);
                            sessionStorage.removeItem(paymentAttemptKey);
                            localStorage.removeItem("selectedWarehouse");
                            alert(verification.reconciliationPending
                                ? "Payment verified. Inventory reconciliation is in progress; your order will be updated shortly."
                                : "Payment verified successfully.");
                            navigate("/shopkeeper/order-history");
                            return;
                        }
                        if (verification.paymentStatus === "Failed") {
                            sessionStorage.removeItem(paymentAttemptKey);
                        }
                        alert("Payment is not yet confirmed. Your order and reserved stock have been retained while its status is checked.");
                    } catch (error) {
                        alert(error.response?.data?.message || "Payment verification is pending. Do not submit another payment; check your order status.");
                    }
                },
                modal: {
                    ondismiss: () => {
                        alert("Payment was not confirmed. Your order and stock reservation are retained; you can safely retry checkout.");
                    }
                },
                theme: { color: "#2563eb" }
            });
            setPlacingOrder(false);
            checkout.open();
        } catch (error) {
            if (["CHECKOUT_EXPIRED", "CHECKOUT_RETRY_NEW_ID"].includes(error.response?.data?.code)) {
                const warehouseId = localStorage.getItem("selectedWarehouse");
                sessionStorage.removeItem(`pendingCheckout:${warehouseId}`);
            }
            const responseCode = error.response?.data?.code;
            const requestId = error.response?.headers?.["x-request-id"];
            const message = error.response?.data?.message || error.message || "Unable to place order.";
            alert(["PAYMENT_ORDER_UNRESOLVED", "RAZORPAY_ORDER_CREATION_FAILED"].includes(responseCode) && requestId
                ? `${message} Support reference: ${requestId}.`
                : message);
        } finally {
            submissionInProgress.current = false;
            setPlacingOrder(false);
        }
    };

    if (loading) {
        return <div className="catalog-container"><h2>Loading checkout...</h2></div>;
    }

    if (!cart.items.length) {
        return (
            <div className="catalog-container">
                <h2 className="page-title">Checkout</h2>
                <div className="empty-cart">
                    <h2>Your cart is empty</h2>
                    <p>Add items from the catalog to complete your order.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="catalog-container order-page">
            <div className="order-header">
                <div>
                    <p className="eyebrow">Checkout</p>
                    <h1>Review order and payment</h1>
                    <p className="subtext">Use saved address, select payment method, apply coupon and confirm your order.</p>
                </div>
            </div>

            <div className="order-grid">
                <section className="order-content">
                    <div className="card delivery-card">
                        <div className="card-title">
                            <div>
                                <h2>Delivery Address</h2>
                                <p>Selected shopkeeper address for delivery</p>
                            </div>
                            <button className="link-button" type="button" onClick={() => setShowAddressList((prev) => !prev)}>
                                {showAddressList ? "Hide Addresses" : "Change Address"}
                            </button>
                        </div>
                        {currentAddress ? (
                            <div className="address-preview">
                                <p><strong>{currentAddress.fullName}</strong></p>
                                <p>{currentAddress.phone}</p>
                                <p>{currentAddress.addressLine1}</p>
                                {currentAddress.addressLine2 && <p>{currentAddress.addressLine2}</p>}
                                <p>{currentAddress.city}, {currentAddress.state} {currentAddress.pincode}</p>
                            </div>
                        ) : (
                            <div className="alert-box">
                                No saved address found. Add an address from the Addresses page.
                            </div>
                        )}
                        {showAddressList && addresses.length > 0 && (
                            <div className="address-list">
                                {addresses.map((address) => (
                                    <label key={address._id} className={`address-option ${selectedAddressId === address._id ? "selected" : ""}`}>
                                        <input
                                            type="radio"
                                            name="deliveryAddress"
                                            value={address._id}
                                            checked={selectedAddressId === address._id}
                                            onChange={() => setSelectedAddressId(address._id)}
                                        />
                                        <div>
                                            <p><strong>{address.fullName}</strong> • {address.addressType}</p>
                                            <p>{formatAddress(address)}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="card payment-card">
                        <div className="card-title">
                            <div>
                                <h2>Payment Method</h2>
                                <p>Select how you'd like to pay for this order.</p>
                            </div>
                        </div>
                        <div className="payment-options">
                            {[
                                    "Cash On Delivery",
                                    "Razorpay"
                                ].map((method) => (
                                <label key={method} className={`payment-option ${paymentMethod === method ? "active" : ""}`}>
                                    <input
                                        type="radio"
                                        name="paymentMethod"
                                        value={method}
                                        checked={paymentMethod === method}
                                        onChange={() => setPaymentMethod(method)}
                                    />
                                    <span>{method === "Razorpay" ? "Razorpay (UPI, cards, net banking)" : method}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="card coupon-card">
                        <div className="card-title">
                            <div>
                                <h2>Coupon Code</h2>
                                <p>Apply a discount coupon to reduce order cost.</p>
                            </div>
                        </div>
                        <div className="coupon-input-row">
                            <input
                                type="text"
                                placeholder="Enter coupon code"
                                value={couponCode}
                                onChange={(e) => setCouponCode(e.target.value)}
                            />
                            <button type="button" onClick={handleApplyCoupon}>
                                Apply
                            </button>
                        </div>
                        {couponMessage && (
                            <p className={`coupon-message ${appliedCoupon ? "success" : "error"}`}>
                                {couponMessage}
                            </p>
                        )}
                    </div>
                </section>

                <aside className="order-sidebar">
                    <div className="card summary-card">
                        <div className="card-title">
                            <div>
                                <h2>Order Summary</h2>
                                <p>{cart.items.length} items from {warehouse?.name || "warehouse"}</p>
                            </div>
                        </div>
                        <div className="summary-list">
                            {cart.items.map((item) => (
                                <div key={item._id} className="summary-item">
                                    <div>
                                        <strong>{item.productName}</strong>
                                        <p>{item.quantity} × ₹{item.price}</p>
                                    </div>
                                    <span>₹{item.subtotal}</span>
                                </div>
                            ))}
                        </div>
                        <div className="summary-total">
                            <div>
                                <span>Original Amount</span>
                                <strong>₹{originalTotal}</strong>
                            </div>
                            <div>
                                <span>Discount</span>
                                <strong>-₹{discountAmount}</strong>
                            </div>
                            <div>
                                <span>GST (18%)</span>
                                <strong>+₹{gstAmount}</strong>
                            </div>
                            <div className="final-row">
                                <span>Final Amount</span>
                                <strong>₹{finalAmount}</strong>
                            </div>
                        </div>
                        <button
                            className="checkout-btn"
                            onClick={handlePlaceOrder}
                            disabled={!currentAddress || placingOrder}
                        >
                            {placingOrder ? "Preparing secure checkout..." : paymentMethod === "Cash On Delivery" ? `Place Order ₹${finalAmount}` : `Pay securely ₹${finalAmount}`}
                        </button>
                    </div>
                </aside>
            </div>
        </div>
    );
}

export default PlaceOrder;