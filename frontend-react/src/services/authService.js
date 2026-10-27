import axios from "axios";
import { API_BASE_URL } from "./api";

const API_URL = `${API_BASE_URL}/auth`;

export const registerUser =
  async (userData) => {

    const response =
      await axios.post(
        `${API_URL}/register`,
        userData
      );

    return response.data;
  };

export const loginUser =
  async (userData) => {

    const response =
      await axios.post(
        `${API_URL}/login`,
        userData
      );

    return response.data;
  };

export const getUsers =
  async () => {

    const response =
      await fetch(
        `${API_URL}/users`
      );

    return response.json();
  };

export const updateRole =
  async (
    id,
    userData
  ) => {

    const response =
      await fetch(
        `${API_URL}/users/${id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify(
            userData
          )
        }
      );

    return response.json();
  };

export const deleteUser =
  async (userId) => {
    const token =
      localStorage.getItem("token");

    const response =
      await fetch(
        `${API_URL}/users/${userId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              token ? `Bearer ${token}` : ""
          }
        }
      );

    return response.json();
  };