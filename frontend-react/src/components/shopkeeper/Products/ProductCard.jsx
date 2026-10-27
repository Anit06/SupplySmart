import QuantitySelector from "./QuantitySelector";
import { getBackendAssetUrl } from "../../../services/api";

function ProductCard({ product, quantity, onIncrease, onDecrease, onAddToCart }) {
    return (
        <div className="product-card">
            <img
                src={product.image ? getBackendAssetUrl(product.image) : "https://via.placeholder.com/180"}
                alt={product.name}
                className="product-image"
            />
            <h3>{product.name}</h3>
            <p><strong>SKU:</strong> {product.sku || product.productId}</p>
            <p><strong>Category:</strong> {product.category}</p>
            <p><strong>₹{product.price}</strong> / {product.unit || "KG"}</p>
            <p><strong>Stock:</strong> {product.stock} {product.unit || "KG"}</p>
            <p>{product.description}</p>
            <QuantitySelector quantity={quantity} onIncrease={onIncrease} onDecrease={onDecrease} max={product.stock} />
            <button className="checkout-btn" type="button" onClick={onAddToCart}>
                Add To Cart
            </button>
        </div>
    );
}

export default ProductCard;
