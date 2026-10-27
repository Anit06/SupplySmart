import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { API_BASE_URL } from "../services/api";

import "../assets/css/auth.css";

function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();

    setLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email,
            password
          })
        }
      );

      const responseText = await response.text();
      let data = null;
      if (responseText.trim()) {
        try {
          data = JSON.parse(responseText);
        } catch {
          if (response.ok) {
            throw new Error("The server returned an invalid login response.");
          }
        }
      }

      if (!response.ok) {
        const statusMessages = {
          400: "Please check your email and password.",
          401: "Invalid email or password.",
          404: "Login endpoint or account was not found.",
          500: "The server encountered an error. Please try again later."
        };
        alert(
          typeof data?.message === "string" && data.message.trim()
            ? data.message
            : statusMessages[response.status] || `Login failed (${response.status}).`
        );
        return;
      }

      if (
        !data
        || typeof data.token !== "string"
        || !data.user
        || !["admin", "administrative_user", "user"].includes(data.user.role)
      ) {
        throw new Error("The server returned an incomplete login response.");
      }

      localStorage.setItem("token", data.token);

      localStorage.setItem(
        "user",
        JSON.stringify(data.user)
      );

      localStorage.setItem(
        "role",
        data.user.role
      );

      localStorage.setItem(
        "name",
        data.user.name
      );

      if (
        data.user.role === "admin" ||
        data.user.role === "administrative_user"
      ) {
        navigate("/admin");
      }
      else if (data.user.role === "user") {
        navigate("/shopkeeper");
      }
      else {
        alert("Invalid User Role");
      }

    } catch (error) {
      alert(
        error instanceof TypeError
          ? "Unable to reach the server. Check your connection and try again."
          : error.message || "Login failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">

      <div className="auth-box">

        <div className="auth-branding" aria-label="SupplySmart brand">
          <img
            src="/images/supplysmart-logo.png"
            alt="SupplySmart logo"
            className="auth-logo"
          />
          <h1>SupplySmart</h1>
        </div>

        <p className="auth-subtitle">Smart Supply Chain Management</p>

        <form onSubmit={handleLogin}>

          <input
            type="email"
            placeholder="Enter Email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            required
          />

          <input
            type="password"
            placeholder="Enter Password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            required
          />

          <button
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing In..." : "Sign In"}
          </button>

        </form>

        <p>
          Don't have an account?

          <Link to="/register">
            <span> Sign Up</span>
          </Link>
        </p>

      </div>

    </div>
  );
}

export default Login;