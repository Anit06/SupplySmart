package com.supplychain.model;

import java.time.Instant;

public class InventoryReservation {

    private String checkoutId;
    private int quantity;
    private String status;
    private Instant createdAt;

    public InventoryReservation() {
    }

    public InventoryReservation(String checkoutId, int quantity, String status) {
        this.checkoutId = checkoutId;
        this.quantity = quantity;
        this.status = status;
        this.createdAt = Instant.now();
    }

    public String getCheckoutId() {
        return checkoutId;
    }

    public void setCheckoutId(String checkoutId) {
        this.checkoutId = checkoutId;
    }

    public int getQuantity() {
        return quantity;
    }

    public void setQuantity(int quantity) {
        this.quantity = quantity;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
