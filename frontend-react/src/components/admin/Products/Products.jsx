import { useEffect, useState } from "react";
import { FaPlus } from "react-icons/fa";

import Sidebar from "../../common/Sidebar";
import ProductList from "./ProductList";
import ProductCard from "./ProductCard";
import AddProduct from "./AddProduct";
import EditProduct from "./EditProduct";
import Filter from "./Filter";

import {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct
} from "../../../services/productService";

import "../../../assets/css/products.css";

function Products() {
  const [products, setProducts] =
    useState([]);

  const [search, setSearch] =
    useState("");

  const [category, setCategory] =
    useState("");

  const [showAddModal,
    setShowAddModal] =
    useState(false);

  const [editProduct,
    setEditProduct] =
    useState(null);

  const [formData,
    setFormData] =
    useState({
      name: "",
      sku: "",
      category: "",
      description: "",
      price: "",
      quantity: "",
      unit: "G",
      stock: "",
      status: "Active",
      image: null
    });

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
      const data =
        await getProducts();

      if (data.success) {
        setProducts(
          data.products
        );
      }
  }

  const handleChange =
    (e) => {
      setFormData({
        ...formData,
        [e.target.name]:
          e.target.value
      });
    };

  const handleImage =
    (e) => {
      setFormData({
        ...formData,
        image:
          e.target.files[0]
      });
    };

  const handleAdd =
    async () => {
      const productData =
        new FormData();

      Object.keys(formData)
        .forEach((key) => {
          productData.append(
            key,
            formData[key]
          );
        });

      const data =
        await addProduct(
          productData
        );

      if (data.success) {
        alert(
          "Product Added Successfully"
        );

        setShowAddModal(false);

        setFormData({
          name: "",
          sku: "",
          category: "",
          description: "",
          price: "",
          quantity: "",
          unit: "G",
          stock: "",
          status: "Active",
          image: null
        });

        loadProducts();
      } else {
        alert(
          data.message ||
          "Failed to add product"
        );
      }
    };

  const handleUpdate =
    async () => {
      const productData =
        new FormData();

      Object.keys(editProduct)
        .forEach((key) => {
          productData.append(
            key,
            editProduct[key]
          );
        });

      const data =
        await updateProduct(
          editProduct._id,
          productData
        );

      if (data.success) {
        alert(
          "Product Updated Successfully"
        );

        setEditProduct(null);

        loadProducts();
      } else {
        alert(
          data.message ||
          "Failed to update product"
        );
      }
    };

  const handleDelete =
    async (id) => {
      const confirmDelete =
        window.confirm(
          "Delete this product?"
        );

      if (!confirmDelete)
        return;

      const data =
        await deleteProduct(id);

      if (data.success) {
        alert(
          "Product Deleted"
        );

        loadProducts();
      }
    };

  const filteredProducts =
    products.filter(
      (product) => {

        const matchSearch =
          product.name
            .toLowerCase()
            .includes(
              search.toLowerCase()
            );

        const matchCategory =
          category === "" ||
          product.category ===
            category;

        return (
          matchSearch &&
          matchCategory
        );
      }
    );

  return (
    <div className="products-layout">

      <Sidebar />

      <div className="products-content">

        <div className="products-header">

          <div>
            <h1>Products</h1>

            <p>
              Manage all products
              and inventory.
            </p>
          </div>

          <button
            className="add-product-btn"
            onClick={() =>
              setShowAddModal(
                true
              )
            }
          >
            <FaPlus />
            Add Product
          </button>

        </div>

        <ProductCard
          products={products}
        />

        <Filter
          search={search}
          setSearch={setSearch}
          category={category}
          setCategory={
            setCategory
          }
          products={products}
        />

        <div className="products-table-wrapper">

          <ProductList
            products={
              filteredProducts
            }
            onEdit={
              setEditProduct
            }
            onDelete={
              handleDelete
            }
          />

        </div>

      </div>

      {showAddModal && (
        <AddProduct
          formData={formData}
          handleChange={
            handleChange
          }
          handleImage={
            handleImage
          }
          handleAdd={
            handleAdd
          }
          onClose={() =>
            setShowAddModal(
              false
            )
          }
        />
      )}

      {editProduct && (
        <EditProduct
          editProduct={
            editProduct
          }
          setEditProduct={
            setEditProduct
          }
          handleUpdate={
            handleUpdate
          }
          onClose={() =>
            setEditProduct(
              null
            )
          }
        />
      )}

    </div>
  );
}

export default Products;