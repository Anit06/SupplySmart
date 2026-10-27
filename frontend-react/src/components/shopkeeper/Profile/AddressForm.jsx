import { useState } from "react";
import "../../../assets/css/address.css";

const initialFormData = {
  fullName: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  landmark: "",
  city: "",
  state: "",
  country: "",
  pincode: "",
  addressType: "Home",
  isDefault: false,
};

const getFormData = (initialData) => initialData ? {
  fullName: initialData.fullName || "",
  phone: initialData.phone || "",
  addressLine1: initialData.addressLine1 || "",
  addressLine2: initialData.addressLine2 || "",
  landmark: initialData.landmark || "",
  city: initialData.city || "",
  state: initialData.state || "",
  country: initialData.country || "",
  pincode: initialData.pincode || "",
  addressType: initialData.addressType || "Home",
  isDefault: Boolean(initialData.isDefault),
} : initialFormData;

function AddressForm({
  show,
  onClose,
  onSave,
  initialData,
  loading = false,
}) {
  const [formData, setFormData] = useState(() => getFormData(initialData));

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const validate = () => {
    if (!formData.fullName.trim()) {
      alert("Full Name is required");
      return false;
    }

    if (!formData.phone.trim()) {
      alert("Phone Number is required");
      return false;
    }

    if (!/^[0-9]{10}$/.test(formData.phone)) {
      alert("Phone number must contain 10 digits");
      return false;
    }

    if (!formData.addressLine1.trim()) {
      alert("Address Line 1 is required");
      return false;
    }

    if (!formData.city.trim()) {
      alert("City is required");
      return false;
    }

    if (!formData.state.trim()) {
      alert("State is required");
      return false;
    }

    if (!formData.country.trim()) {
      alert("Country is required");
      return false;
    }

    if (!/^[0-9]{6}$/.test(formData.pincode)) {
      alert("Enter valid 6 digit pincode");
      return false;
    }

    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    onSave(formData);
    if (!initialData) {
      setFormData(initialFormData);
    }
  };

  if (!show) return null;

  return (
    <form className="address-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Full Name*</label>
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleChange}
          placeholder="Enter Full Name"
        />
      </div>

      <div className="form-group">
        <label>Phone Number*</label>
        <input
          type="text"
          name="phone"
          value={formData.phone}
          onChange={handleChange}
          placeholder="Enter Phone Number"
        />
      </div>

      <div className="form-group">
        <label>Address Line 1*</label>
        <input
          type="text"
          name="addressLine1"
          value={formData.addressLine1}
          onChange={handleChange}
          placeholder="House No., Street..."
        />
      </div>

      <div className="form-group">
        <label>Address Line 2</label>
        <input
          type="text"
          name="addressLine2"
          value={formData.addressLine2}
          onChange={handleChange}
          placeholder="Area, Locality"
        />
      </div>

      <div className="form-group">
        <label>Landmark</label>
        <input
          type="text"
          name="landmark"
          value={formData.landmark}
          onChange={handleChange}
          placeholder="Nearby Landmark"
        />
      </div>

      <div className="address-row">
        <div className="form-group">
          <label>City*</label>
          <input
            type="text"
            name="city"
            value={formData.city}
            onChange={handleChange}
          />
        </div>
        <div className="form-group">
          <label>State*</label>
          <input
            type="text"
            name="state"
            value={formData.state}
            onChange={handleChange}
          />
        </div>
      </div>

      <div className="address-row">
        <div className="form-group">
          <label>Country*</label>
          <input
            type="text"
            name="country"
            value={formData.country}
            onChange={handleChange}
          />
        </div>
        <div className="form-group">
          <label>Pincode*</label>
          <input
            type="text"
            name="pincode"
            value={formData.pincode}
            onChange={handleChange}
          />
        </div>
      </div>

      <div className="address-row">
        <div className="form-group">
          <label>Address Type</label>
          <select
            name="addressType"
            value={formData.addressType}
            onChange={handleChange}
          >
            <option value="Home">Home</option>
            <option value="Shop">Shop</option>
            <option value="Office">Office</option>
            <option value="Warehouse">Warehouse</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>

      <div className="default-address-container">
        <input
          type="checkbox"
          name="isDefault"
          checked={formData.isDefault}
          onChange={handleChange}
          className="default-address-checkbox"
        />

        <label className="default-address-label">Set as Default</label>
      </div>
      <div className="address-form-buttons">
        <button type="button" className="cancel-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="save-btn" disabled={loading}>
          {loading ? "Saving..." : initialData ? "Update Address" : "Save Address"}
        </button>
      </div>
    </form>
  );
}

export default AddressForm;
