import { FaEdit, FaTrash } from "react-icons/fa";
import { getBackendAssetUrl } from "../../../services/api";

function ProductList({ products, onEdit, onDelete }) {
  if (!products.length) {
    return (
      <h3 className="no-products">
        No Products Found
      </h3>
    );
  }

  // Dynamically compute the stock status text based on live stock numbers
  const getDynamicStockStatus = (stock) => {
    const stockNum = Number(stock);
    if (isNaN(stockNum) || stockNum <= 0) {
      return "Out Of Stock";
    }
    if (stockNum <= 20) {
      return "Low Stock";
    }
    return "In Stock";
  };

  return (
    <table className="products-table">
      <thead>
        <tr>
          <th>Product</th>
          <th>SKU</th>
          <th>Category</th>
          <th>Price</th>
          <th>Quantity</th>
          <th>Unit</th>
          <th>Stock</th>
          <th>Status</th>
          <th>Stock Status</th>
          <th>Created</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>
        {products.map((product) => {
          // Calculate the status on the fly for each product row
          const computedStockStatus = getDynamicStockStatus(product.stock);

          return (
            <tr key={product._id}>
              <td>
                <div className="product-info">
                  <img
                    src={
                      product.image
                        ? getBackendAssetUrl(product.image)
                        : "https://via.placeholder.com/60"
                    }
                    alt={product.name}
                  />
                  <div>
                    <h4>{product.name}</h4>
                    <p>{product.description}</p>
                  </div>
                </div>
              </td>

              <td>{product.sku}</td>
              <td>{product.category}</td>
              <td>₹{product.price}</td>
              <td>{product.quantity}</td>
              <td>{product.unit}</td>
              <td>{product.stock}</td>

              <td>
                <span
                  className={`status ${(product.status || "").toLowerCase()}`}
                >
                  {product.status}
                </span>
              </td>

              <td>
                <span
                  className={`stock-status ${computedStockStatus
                    .toLowerCase()
                    .replace(/\s/g, "-")}`}
                >
                  {computedStockStatus}
                </span>
              </td>

              <td>
                {new Date(product.createdAt).toLocaleDateString()}
              </td>

              <td>
                <button
                  className="action-btn edit"
                  onClick={() => onEdit(product)}
                >
                  <FaEdit />
                </button>

                <button
                  className="action-btn delete"
                  onClick={() => onDelete(product._id)}
                >
                  <FaTrash />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default ProductList;