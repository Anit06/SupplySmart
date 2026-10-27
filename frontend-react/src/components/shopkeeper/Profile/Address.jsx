import { useEffect, useState } from "react";
import {
  getProfile,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from "../../../services/shopkeeperService";
import AddressCard from "./AddressCard";
import AddressModal from "./AddressModal";
import "../../../assets/css/address.css";

function Address() {
  const [addresses, setAddresses] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAddress, setEditingAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    let active = true;
    const user = JSON.parse(localStorage.getItem("user") || "{}") || {};
    if (!user.id) return undefined;

    getProfile(user.id)
      .then((response) => {
        if (!active) return;
        setUserId(user.id);
        setAddresses(response.data.profile.addresses || []);
      })
      .catch(() => {
        if (active) {
          setFeedback({ type: "error", message: "Failed to fetch your addresses" });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const handleOpenAdd = () => {
    setEditingAddress(null);
    setShowModal(true);
  };

  const handleEdit = (address) => {
    setEditingAddress(address);
    setShowModal(true);
  };

  const handleSubmit = async (formData) => {
    setLoading(true);
    setFeedback({ type: "", message: "" });

    try {
      if (!userId) throw new Error("Profile not ready");

      let response;
      if (editingAddress?._id) {
        response = await updateAddress(userId, editingAddress._id, formData);
      } else {
        response = await addAddress(userId, formData);
      }

      setAddresses(response.data.addresses || []);
      setFeedback({ type: "success", message: response.data.message || "Address saved successfully" });
      setShowModal(false);
      setEditingAddress(null);
    } catch (error) {
      setFeedback({ type: "error", message: error.response?.data?.message || error.message || "Failed to save address" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (addressId) => {
    try {
      const response = await deleteAddress(userId, addressId);
      setAddresses(response.data.addresses || []);
      setFeedback({ type: "success", message: response.data.message || "Address removed" });
    } catch (error) {
      setFeedback({ type: "error", message: error.response?.data?.message || error.message || "Failed to delete address" });
    }
  };

  const handleSetDefault = async (addressId) => {
    try {
      const response = await setDefaultAddress(userId, addressId);
      setAddresses(response.data.addresses || []);
      setFeedback({ type: "success", message: response.data.message || "Default address updated" });
    } catch (error) {
      setFeedback({ type: "error", message: error.response?.data?.message || error.message || "Failed to set default address" });
    }
  };

  return (
    <div className="address-page">
      <div className="address-header">
        <h2>Shop Addresses</h2>
        <button className="add-address-btn" onClick={handleOpenAdd}>+ Add Address</button>
      </div>

      {feedback.message && (
        <div style={{ marginBottom: "12px", color: feedback.type === "success" ? "#0f9d58" : "#d93025", fontWeight: 600 }}>
          {feedback.message}
        </div>
      )}

      {addresses.length === 0 ? (
        <div className="no-address">No addresses saved yet. Add your first address.</div>
      ) : (
        addresses.map((address) => (
          <AddressCard
            key={address._id}
            address={address}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
          />
        ))
      )}

      <AddressModal
        show={showModal}
        onClose={() => setShowModal(false)}
        onSubmit={handleSubmit}
        initialData={editingAddress}
        loading={loading}
      />
    </div>
  );
}

export default Address;
