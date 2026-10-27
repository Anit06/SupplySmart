import { useEffect } from "react";
import AppRoutes from "./routes/AppRoutes";
import "./assets/css/design-system.css";

function App() {
  useEffect(() => {
    document.title = "SupplySmart | Smart Supply Chain Management";
  }, []);

  return <AppRoutes />;
}

export default App;