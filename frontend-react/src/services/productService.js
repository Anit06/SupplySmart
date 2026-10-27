import axios from "axios";
import { API_BASE_URL } from "./api";

const API = `${API_BASE_URL}/products`;

export const getProducts =
  async () => {

    const response =
      await axios.get(API);

    return response.data;
  };

export const addProduct = async (
  productData
) => {

  const response =
    await axios.post(
      API,
      productData,
      {
        headers: {
          "Content-Type":
            "multipart/form-data"
        }
      }
    );

  return response.data;
};

export const updateProduct =
  async (
    id,
    formData
  ) => {

    const response =
      await axios.put(
        `${API}/${id}`,
        formData,
        {
          headers: {
            "Content-Type":
              "multipart/form-data"
          }
        }
      );

    return response.data;
  };

export const deleteProduct =
  async (id) => {

    const response =
      await axios.delete(
        `${API}/${id}`
      );

    return response.data;
  };