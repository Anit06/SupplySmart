import axios from "axios";
import { API_BASE_URL } from "./api";

const API = `${API_BASE_URL}/warehouses`;

export const getWarehouses =
  async () => {
    const res =
      await axios.get(API);

    return res.data;
  };

export const getWarehouseById =
  async (id) => {
    const res =
      await axios.get(`${API}/${id}`);

    return res.data;
  };

export const addWarehouse =
  async (data) => {
    const res =
      await axios.post(
        API,
        data
      );

    return res.data;
  };

export const updateWarehouse =
  async (id, data) => {
    const res =
      await axios.put(
        `${API}/${id}`,
        data
      );

    return res.data;
  };

export const deleteWarehouse =
  async (id) => {
    const res =
      await axios.delete(
        `${API}/${id}`
      );

    return res.data;
  };