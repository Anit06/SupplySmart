import { NavLink } from "react-router-dom";
import {
  FaTachometerAlt,
  FaBoxOpen,
  FaWarehouse,
  FaShoppingCart,
  FaRobot,
  FaFileAlt,
  FaUsers,
  FaTruck,
} from "react-icons/fa";

import "../../assets/css/sidebar.css";

const navItems = [
  { to: "/admin/dashboard", label: "Dashboard", icon: FaTachometerAlt },
  { to: "/admin/products", label: "Products", icon: FaBoxOpen },
  { to: "/admin/warehouses", label: "Warehouses", icon: FaWarehouse },
  { to: "/admin/orders", label: "Orders", icon: FaShoppingCart },
  { to: "/admin/ai-prediction", label: "AI Predictions", icon: FaRobot },
  { to: "/admin/reports", label: "Reports", icon: FaFileAlt },
  { to: "/admin/users", label: "Users", icon: FaUsers },
  { to: "/admin/suppliers", label: "Suppliers", icon: FaTruck },
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-logo">
          <img
            src="/images/supplysmart-logo.png"
            alt="SupplySmart logo"
            className="brand-logo brand-logo--sidebar"
          />
          <div className="logo-text">
            <h1>SupplySmart</h1>
            <p>Smart Logistics</p>
          </div>
        </div>

        <ul className="sidebar-menu">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    isActive ? "sidebar-link active" : "sidebar-link"
                  }
                >
                  <Icon className="menu-icon" />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="sidebar-profile">
        <div className="profile-image">👨</div>
        <div>
          <h3>Admin</h3>
          <p>Operations</p>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;