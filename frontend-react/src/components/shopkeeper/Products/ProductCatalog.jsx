import { useEffect, useState } from "react";
import "../../../assets/css/ProductCatalog.css";
import { getWarehouses } from "../../../services/warehouseService";
import { getWarehouseCatalog } from "../../../services/catalogService";
import { addToCart } from "../../../services/cartService";
import WarehouseSelector from "./WarehouseSelector";
import ProductCard from "./ProductCard";

function ProductCatalog() {
    const [warehouses, setWarehouses] = useState([]);
    const [selectedWarehouse, setSelectedWarehouse] = useState("");
    const [products, setProducts] = useState([]);
    const [selectedQuantities, setSelectedQuantities] = useState({});

    // Search & Filter
    const [searchTerm, setSearchTerm] = useState("");
    const [sortOrder, setSortOrder] = useState("");

    useEffect(() => {
        let active = true;
        getWarehouses()
            .then((res) => {
                if (!active) return;
                const activeWarehouses = (res.warehouses || []).filter(
                    (warehouse) =>
                        warehouse.status &&
                        warehouse.status.toLowerCase() === "active"
                );
                setWarehouses(activeWarehouses);
            })
            .catch((error) => console.log(error));

        return () => {
            active = false;
        };
    }, []);

    async function loadProducts(warehouseId) {
        try {
            const res = await getWarehouseCatalog(warehouseId);
            setProducts(res.data.products || []);
            localStorage.setItem("selectedWarehouse", warehouseId);
        } catch (error) {
            console.log(error);
        }
    }

    const increaseQuantity = (product) => {
        const qty = selectedQuantities[product.productId] || 1;

        if (qty >= product.stock) {
            alert(`Only ${product.stock} items available`);
            return;
        }

        setSelectedQuantities({
            ...selectedQuantities,
            [product.productId]: qty + 1,
        });
    };

    const decreaseQuantity = (productId) => {
        const qty = selectedQuantities[productId] || 1;

        if (qty <= 1) return;

        setSelectedQuantities({
            ...selectedQuantities,
            [productId]: qty - 1,
        });
    };

    const handleAddToCart = async (product) => {

        if (!selectedWarehouse) {

            alert("Please select a warehouse");

            return;
        }

        const quantity =
            selectedQuantities[product.productId] || 1;

        try {

            await addToCart({

                warehouseId: selectedWarehouse,

                productId: product.productId,

                productName: product.name,

                category: product.category,

                image: product.image,

                sku: product.sku,

                description: product.description,

                unit: product.unit || "KG",

                price: product.price,

                quantity: quantity

            });

            alert("Added to Cart Successfully");

        }

        catch (error) {

            console.log(error);

            alert(
                error.response?.data?.message ||
                "Unable to add product."
            );
        }

    };

    const handleWarehouseChange = (e) => {
        const warehouseId = e.target.value;

        setSelectedWarehouse(warehouseId);
        setProducts([]);
        setSelectedQuantities({});
        setSearchTerm("");
        setSortOrder("");

        if (warehouseId) {
            loadProducts(warehouseId);
        }
    };

    // Search
    let filteredProducts = products.filter((product) =>
        product.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Sort
    if (sortOrder === "low-high") {
        filteredProducts.sort((a, b) => a.price - b.price);
    }

    if (sortOrder === "high-low") {
        filteredProducts.sort((a, b) => b.price - a.price);
    }

    return (
        <div className="catalog-container">

            <div className="catalog-header">
                <h2>Product Catalog</h2>

                <WarehouseSelector
                    warehouses={warehouses}
                    selectedWarehouse={selectedWarehouse}
                    onChange={handleWarehouseChange}
                />
            </div>

            {selectedWarehouse && (
                <div className="catalog-toolbar">

                    <input
                        type="text"
                        placeholder="🔍 Search Product..."
                        className="catalog-search"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />

                    <select
                        className="catalog-filter"
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value)}
                    >
                        <option value="">Sort By Price</option>
                        <option value="low-high">Price : Low → High</option>
                        <option value="high-low">Price : High → Low</option>
                    </select>

                </div>
            )}

            {selectedWarehouse === "" ? (
                <h3 style={{ textAlign: "center", marginTop: "60px" }}>
                    Please Select Warehouse
                </h3>
            ) : filteredProducts.length === 0 ? (
                <h3 style={{ textAlign: "center", marginTop: "60px" }}>
                    No Products Found
                </h3>
            ) : (
                <div className="catalog-grid">
                    {filteredProducts.map((product) => (
                        <ProductCard
                            key={product.productId}
                            product={product}
                            quantity={
                                selectedQuantities[product.productId] || 1
                            }
                            onIncrease={() => increaseQuantity(product)}
                            onDecrease={() =>
                                decreaseQuantity(product.productId)
                            }
                            onAddToCart={() =>
                                handleAddToCart(product)
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default ProductCatalog;