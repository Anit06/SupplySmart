import { useState, useEffect } from "react";
import { getProfile, updateProfile, getProductCategories, } from "../../../services/shopkeeperService";
import "../../../assets/css/profile.css";
import Select from "react-select";

function Profile() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    shopCategory: [],
  });
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  const [categoryOptions, setCategoryOptions] = useState([]);

  const fetchProfile = async () => {
    try {
      const user = JSON.parse(localStorage.getItem("user") || "{}") || {};
      if (!user.id) return;

      setUserId(user.id);
      const response = await getProfile(user.id);
      const profile = response.data.profile;
      setFormData({
        fullName: profile.fullName || "",
        email: profile.userId?.email || "",
        phone: profile.phone || "",
        shopCategory: profile.shopCategory || [],
      });
    } catch (error) {
      console.error("Error fetching profile:", error);
      setFeedback({
        type: "error",
        message: "Unable to load your profile right now.",
      });
    }
  };
  useEffect(() => {
    let active = true;
    const user = JSON.parse(localStorage.getItem("user") || "{}") || {};
    if (user.id) {
      getProfile(user.id)
        .then((response) => {
          if (!active) return;
          const profile = response.data.profile;
          setUserId(user.id);
          setFormData({
            fullName: profile.fullName || "",
            email: profile.userId?.email || "",
            phone: profile.phone || "",
            shopCategory: profile.shopCategory || [],
          });
        })
        .catch((error) => {
          console.error("Error fetching profile:", error);
          if (active) {
            setFeedback({
              type: "error",
              message: "Unable to load your profile right now.",
            });
          }
        });
    }

    getProductCategories()
      .then((response) => {
        const options = response.data.categories.map((category) => ({
          value: category,
          label: category,
        }));
        if (active) setCategoryOptions(options);
      })
      .catch((error) => console.error("Error fetching categories:", error));

    return () => {
      active = false;
    };
  }, []);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFeedback({ type: "", message: "" });

    try {
      if (!userId) {
        throw new Error("Profile not ready");
      }

      if (!formData.fullName || !formData.phone || formData.shopCategory.length === 0) {
        throw new Error("Full name, phone, and at least shop category are required");
      }

      if (!/^\d{10}$/.test(formData.phone)) {
        throw new Error("Phone number must be 10 digits");
      }

      const response = await updateProfile(userId, formData);
      localStorage.setItem("name", formData.fullName || "");
      setFeedback({ type: "success", message: response.data.message });
      await fetchProfile();
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error.response?.data?.message ||
          error.message ||
          "Failed to update profile",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    fetchProfile();
    setFeedback({ type: "", message: "" });
  };

  return (
    <div className="profile-page">
      <div className="profile-card">
        {/* Header Section */}
        <div className="profile-header">
          <div className="profile-avatar">
            {formData.fullName
              ? formData.fullName.charAt(0).toUpperCase()
              : "U"}
          </div>
          <div className="profile-titles">
            <h2>My Profile</h2>
            <p>Manage your shopkeeper information</p>
          </div>
        </div>

        {/* Form Container */}
        <form className="profile-form" onSubmit={handleSubmit}>
          {/* Feedback Banner */}
          {feedback.message && (
            <div
              className="profile-message"
              style={{
                background: feedback.type === "success" ? "#e7f8ee" : "#fdecec",
                color: feedback.type === "success" ? "#0f9d58" : "#d93025",
              }}
            >
              {feedback.message}
            </div>
          )}

          {/* Full Name */}
          <div className="form-group">
            <label>Full Name*</label>
            <input
              type="text"
              name="fullName"
              value={formData.fullName}
              onChange={handleChange}
              placeholder="Enter full name"
            />
          </div>

          {/* Email */}
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              readOnly
              placeholder="Email"
            />
          </div>

          {/* Phone Number */}
          <div className="form-group">
            <label>Phone Number*</label>
            <input
              type="text"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="Enter your phone number"
              style={{ marginTop: "15px" }}
            />
          </div>

          {/* Shop Category */}
          <div className="form-group">
            <label>Shop Category*</label>

            <Select
              isMulti
              options={categoryOptions}
              placeholder="Search and select categories..."
              value={categoryOptions.filter((option) =>
                formData.shopCategory.includes(option.value),
              )}
              onChange={(selectedOptions) =>
                setFormData({
                  ...formData,
                  shopCategory: selectedOptions
                    ? selectedOptions.map((option) => option.value)
                    : [],
                })
              }
            />
          </div>

          {/* Action Buttons */}
          <div className="button-container">
            <button type="submit" className="profile-btn" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </button>
            <button type="button" className="cancel-btn" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Profile;
