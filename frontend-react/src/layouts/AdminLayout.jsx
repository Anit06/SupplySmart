import { Outlet } from "react-router-dom";

function AdminLayout() {
  return (
    <div className="dashboard-layout">
      <div className="dashboard-main">
        <Outlet />
      </div>

    </div>
  );
}

export default AdminLayout;