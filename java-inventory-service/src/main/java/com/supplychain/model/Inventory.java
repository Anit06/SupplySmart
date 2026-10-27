package com.supplychain.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;
import java.util.ArrayList;
import java.util.List;

@Document(collection = "inventory")
@CompoundIndex(
        name = "warehouse_product_unique",
        def = "{'warehouse': 1, 'product': 1}",
        unique = true)
public class Inventory {

    @Id
    private String id;

    private String warehouse;

    private String product;

    private int stock;

    private List<InventoryReservation> reservations = new ArrayList<>();

    public Inventory() {
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getWarehouse() {
        return warehouse;
    }

    public void setWarehouse(String warehouse) {
        this.warehouse = warehouse;
    }

    public String getProduct() {
        return product;
    }

    public void setProduct(String product) {
        this.product = product;
    }

    public int getStock() {
        return stock;
    }

    public void setStock(int stock) {
        this.stock = stock;
    }

    public List<InventoryReservation> getReservations() {
        return reservations;
    }

    public void setReservations(List<InventoryReservation> reservations) {
        this.reservations = reservations;
    }
}