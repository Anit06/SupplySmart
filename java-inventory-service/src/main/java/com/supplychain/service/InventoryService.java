package com.supplychain.service;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import org.bson.Document;
import org.bson.types.ObjectId;
import org.springframework.stereotype.Service;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import com.mongodb.client.result.UpdateResult;

import com.supplychain.dto.InventoryReservationRequest;
import com.supplychain.dto.ReduceInventoryRequest;
import com.supplychain.dto.InventoryRequest;
import com.supplychain.dto.InventoryResponse;
import com.supplychain.model.Inventory;
import com.supplychain.model.InventoryReservation;
import com.supplychain.model.Product;
import com.supplychain.model.ProductHolding;
import com.supplychain.model.Warehouse;
import com.supplychain.repository.InventoryRepository;
import com.supplychain.repository.ProductHoldingRepository;
import com.supplychain.repository.ProductRepository;
import com.supplychain.repository.WarehouseRepository;

@Service
public class InventoryService {

    private final InventoryRepository inventoryRepository;
    private final ProductRepository productRepository;
    private final WarehouseRepository warehouseRepository;
    private final ProductHoldingRepository productHoldingRepository;
    private final MongoTemplate mongoTemplate;

    public InventoryService(
            InventoryRepository inventoryRepository,
            ProductRepository productRepository,
            WarehouseRepository warehouseRepository,
            ProductHoldingRepository productHoldingRepository,
            MongoTemplate mongoTemplate) {

        this.inventoryRepository = inventoryRepository;
        this.productRepository = productRepository;
        this.warehouseRepository = warehouseRepository;
        this.productHoldingRepository = productHoldingRepository;
        this.mongoTemplate = mongoTemplate;
    }

    // ==============================
    // GET INVENTORY BY WAREHOUSE
    // ==============================
    public List<InventoryResponse> getInventoryByWarehouse(String warehouseId) {

        List<Inventory> inventoryList =
                inventoryRepository.findByWarehouse(warehouseId);

        List<InventoryResponse> responseList = new ArrayList<>();

        for (Inventory inventory : inventoryList) {

            InventoryResponse dto = new InventoryResponse();

            dto.setInventoryId(inventory.getId());
            dto.setWarehouseId(inventory.getWarehouse());
            dto.setProductId(inventory.getProduct());
            dto.setStock(inventory.getStock());

            productRepository.findById(inventory.getProduct())
                    .ifPresent(product -> {
                        dto.setProductName(product.getName());
                        dto.setCategory(product.getCategory());
                    });

            warehouseRepository.findById(inventory.getWarehouse())
                    .ifPresent(warehouse -> {
                        dto.setWarehouseName(warehouse.getName());
                    });

            responseList.add(dto);
        }

        return responseList;
    }

    public List<InventoryResponse> getAllInventory() {

    List<Inventory> inventoryList = inventoryRepository.findAll();

    List<InventoryResponse> responseList = new ArrayList<>();

    for (Inventory inventory : inventoryList) {

        InventoryResponse dto = new InventoryResponse();

        dto.setInventoryId(inventory.getId());
        dto.setWarehouseId(inventory.getWarehouse());
        dto.setProductId(inventory.getProduct());
        dto.setStock(inventory.getStock());

        productRepository.findById(inventory.getProduct())
                .ifPresent(product -> {
                    dto.setProductName(product.getName());
                    dto.setCategory(product.getCategory());
                });

        warehouseRepository.findById(inventory.getWarehouse())
                .ifPresent(warehouse -> {
                    dto.setWarehouseName(warehouse.getName());
                });

        responseList.add(dto);
    }

    return responseList;
}

    // ==============================
    // ADD INVENTORY (USES HOLDING)
    // ==============================
    public InventoryResponse addInventory(InventoryRequest request) {

        Warehouse warehouse = warehouseRepository.findById(request.getWarehouseId())
                .orElseThrow(() -> new RuntimeException("Warehouse not found"));

        Product product = productRepository.findById(request.getProductId())
                .orElseThrow(() -> new RuntimeException("Product not found"));

        ObjectId productObjectId = new ObjectId(request.getProductId());
        ProductHolding holding = productHoldingRepository.findByProductId(productObjectId)
                .orElseThrow(() -> new RuntimeException("Product holding not found"));

        Optional<Inventory> existing =
                inventoryRepository.findByWarehouseAndProduct(
                        request.getWarehouseId(),
                        request.getProductId());

        if (existing.isPresent()) {
            throw new RuntimeException("Product already exists in warehouse");
        }

        // check stock in holding
        if (holding.getStock() < request.getStock()) {
            throw new RuntimeException("Not enough stock available in ProductHolding");
        }

        // create inventory
        Inventory inventory = new Inventory();
        inventory.setWarehouse(request.getWarehouseId());
        inventory.setProduct(request.getProductId());
        inventory.setStock(request.getStock());

        inventoryRepository.save(inventory);

        // reduce holding stock
        holding.setStock(holding.getStock() - request.getStock());
        holding.setStockStatus(holding.getStock() <= 0 ? "Out Of Stock" : "In Stock");

        productHoldingRepository.save(holding);

        // response
        InventoryResponse response = new InventoryResponse();
        response.setInventoryId(inventory.getId());
        response.setWarehouseId(warehouse.getId());
        response.setWarehouseName(warehouse.getName());
        response.setProductId(product.getId());
        response.setProductName(product.getName());
        response.setCategory(product.getCategory());
        response.setStock(inventory.getStock());

        return response;
    }

    // ==============================
    // UPDATE INVENTORY STOCK
    // ==============================
    public InventoryResponse updateStock(String inventoryId, int newStock) {

        Inventory inventory = inventoryRepository.findById(inventoryId)
                .orElseThrow(() -> new RuntimeException("Inventory not found"));

        ProductHolding holding = productHoldingRepository.findByProductId(new ObjectId(inventory.getProduct()))
                .orElseThrow(() -> new RuntimeException("Product holding not found"));

        int oldStock = inventory.getStock();
        int diff = newStock - oldStock;

        // if increasing stock → check holding availability
        if (diff > 0 && holding.getStock() < diff) {
            throw new RuntimeException("Not enough stock in ProductHolding");
        }

        inventory.setStock(newStock);
        inventoryRepository.save(inventory);

        holding.setStock(holding.getStock() - diff);
        holding.setStockStatus(holding.getStock() <= 0 ? "Out Of Stock" : "In Stock");

        productHoldingRepository.save(holding);

        InventoryResponse response = new InventoryResponse();

        response.setInventoryId(inventory.getId());
        response.setWarehouseId(inventory.getWarehouse());
        response.setProductId(inventory.getProduct());
        response.setStock(inventory.getStock());

        productRepository.findById(inventory.getProduct())
                .ifPresent(product -> {
                    response.setProductName(product.getName());
                    response.setCategory(product.getCategory());
                });

        warehouseRepository.findById(inventory.getWarehouse())
                .ifPresent(warehouse -> {
                    response.setWarehouseName(warehouse.getName());
                });

        return response;
    }

    // ==============================
    // DELETE INVENTORY
    // ==============================
    public void removeInventory(String inventoryId) {

        Inventory inventory = inventoryRepository.findById(inventoryId)
                .orElseThrow(() -> new RuntimeException("Inventory not found"));

        ProductHolding holding = productHoldingRepository.findByProductId(new ObjectId(inventory.getProduct()))
                .orElse(null);

        if (holding != null) {

            holding.setStock(holding.getStock() + inventory.getStock());
            holding.setStockStatus(holding.getStock() <= 0 ? "Out Of Stock" : "In Stock");

            productHoldingRepository.save(holding);
        }

        inventoryRepository.deleteById(inventoryId);
    }

    // =====================================
    // REDUCE INVENTORY AFTER ORDER
    // =====================================

    public InventoryResponse reduceInventory(
            ReduceInventoryRequest request) {

        if (request.getQuantity() < 1) {
            throw new RuntimeException("Quantity must be at least 1");
        }

        Query query = Query.query(Criteria.where("warehouse").is(request.getWarehouseId())
                .and("product").is(request.getProductId())
                .and("stock").gte(request.getQuantity()));
        UpdateResult result = mongoTemplate.updateFirst(
                query, new Update().inc("stock", -request.getQuantity()), Inventory.class);

        if (result.getMatchedCount() == 0) {
            throw new RuntimeException("Not enough stock available");
        }

        Inventory inventory = inventoryRepository
                .findByWarehouseAndProduct(request.getWarehouseId(), request.getProductId())
                .orElseThrow(() -> new RuntimeException("Inventory not found"));

        return toInventoryResponse(inventory);
    }

    public InventoryResponse reserveInventory(InventoryReservationRequest request) {
        validateReservationRequest(request);

        Optional<Inventory> existing = inventoryRepository.findByWarehouseAndProduct(
                request.getWarehouseId(), request.getProductId());
        if (existing.isEmpty()) {
            throw new RuntimeException("Inventory not found");
        }

        Optional<InventoryReservation> existingReservation =
                findReservation(existing.get(), request.getCheckoutId());
        if (existingReservation.isPresent()) {
            if ("RELEASED".equals(existingReservation.get().getStatus())) {
                throw new RuntimeException("Reservation has already been released");
            }
            if (existingReservation.get().getQuantity() != request.getQuantity()) {
                throw new RuntimeException("Checkout reservation quantity does not match");
            }
            return toInventoryResponse(existing.get());
        }

        Criteria reservationMissing = Criteria.where("reservations.checkoutId")
                .ne(request.getCheckoutId());
        Query query = Query.query(new Criteria().andOperator(
                Criteria.where("warehouse").is(request.getWarehouseId()),
                Criteria.where("product").is(request.getProductId()),
                Criteria.where("stock").gte(request.getQuantity()),
                reservationMissing));
        Update update = new Update()
                .inc("stock", -request.getQuantity())
                .push("reservations", new Document()
                        .append("checkoutId", request.getCheckoutId())
                        .append("quantity", request.getQuantity())
                        .append("status", "RESERVED")
                        .append("createdAt", new Date()));
        UpdateResult result = mongoTemplate.updateFirst(query, update, Inventory.class);

        Inventory inventory = inventoryRepository.findByWarehouseAndProduct(
                request.getWarehouseId(), request.getProductId())
                .orElseThrow(() -> new RuntimeException("Inventory not found"));
        if (result.getMatchedCount() == 0) {
            Optional<InventoryReservation> racedReservation =
                    findReservation(inventory, request.getCheckoutId());
            if (racedReservation.isPresent()
                    && racedReservation.get().getQuantity() == request.getQuantity()
                    && !"RELEASED".equals(racedReservation.get().getStatus())) {
                return toInventoryResponse(inventory);
            }
            throw new RuntimeException("Not enough stock available");
        }

        return toInventoryResponse(inventory);
    }

    public void releaseReservation(InventoryReservationRequest request) {
        validateReservationRequest(request);

        Inventory inventory = inventoryRepository.findByWarehouseAndProduct(
                request.getWarehouseId(), request.getProductId())
                .orElseThrow(() -> new RuntimeException("Inventory not found"));
        Optional<InventoryReservation> reservation =
                findReservation(inventory, request.getCheckoutId());
        if (reservation.isEmpty()) {
            return;
        }
        if ("RELEASED".equals(reservation.get().getStatus())) {
            return;
        }
        if (reservation.get().getQuantity() != request.getQuantity()) {
            throw new RuntimeException("Checkout reservation quantity does not match");
        }
        if ("COMMITTED".equals(reservation.get().getStatus())) {
            throw new RuntimeException("Committed inventory reservation cannot be released");
        }
        if (!"RESERVED".equals(reservation.get().getStatus())) {
            throw new RuntimeException("Inventory reservation cannot be released");
        }

        Query query = Query.query(new Criteria().andOperator(
                Criteria.where("warehouse").is(request.getWarehouseId()),
                Criteria.where("product").is(request.getProductId()),
                Criteria.where("reservations").elemMatch(new Criteria().andOperator(
                        Criteria.where("checkoutId").is(request.getCheckoutId()),
                        Criteria.where("quantity").is(request.getQuantity()),
                        Criteria.where("status").is("RESERVED")))));
        UpdateResult result = mongoTemplate.updateFirst(query, new Update()
                .inc("stock", request.getQuantity())
                .set("reservations.$.status", "RELEASED"), Inventory.class);
        if (result.getMatchedCount() == 0) {
            Inventory latest = inventoryRepository.findByWarehouseAndProduct(
                    request.getWarehouseId(), request.getProductId())
                    .orElseThrow(() -> new RuntimeException("Inventory not found"));
            Optional<InventoryReservation> latestReservation =
                    findReservation(latest, request.getCheckoutId());
            if (latestReservation.isPresent()
                    && "COMMITTED".equals(latestReservation.get().getStatus())) {
                throw new RuntimeException("Committed inventory reservation cannot be released");
            }
        }
    }

    public void commitReservation(InventoryReservationRequest request) {
        validateReservationRequest(request);

        Inventory inventory = inventoryRepository.findByWarehouseAndProduct(
                request.getWarehouseId(), request.getProductId())
                .orElseThrow(() -> new RuntimeException("Inventory not found"));
        Optional<InventoryReservation> reservation =
                findReservation(inventory, request.getCheckoutId());
        if (reservation.isEmpty()
                || reservation.get().getQuantity() != request.getQuantity()) {
            throw new RuntimeException("Inventory reservation not found");
        }
        if ("COMMITTED".equals(reservation.get().getStatus())) {
            return;
        }
        if (!"RESERVED".equals(reservation.get().getStatus())) {
            throw new RuntimeException("Inventory reservation cannot be committed");
        }

        Query query = Query.query(new Criteria().andOperator(
                Criteria.where("warehouse").is(request.getWarehouseId()),
                Criteria.where("product").is(request.getProductId()),
                Criteria.where("reservations").elemMatch(new Criteria().andOperator(
                        Criteria.where("checkoutId").is(request.getCheckoutId()),
                        Criteria.where("quantity").is(request.getQuantity()),
                        Criteria.where("status").is("RESERVED")))));
        UpdateResult result = mongoTemplate.updateFirst(query,
                new Update().set("reservations.$.status", "COMMITTED"), Inventory.class);
        if (result.getMatchedCount() == 0) {
            Inventory latest = inventoryRepository.findByWarehouseAndProduct(
                    request.getWarehouseId(), request.getProductId())
                    .orElseThrow(() -> new RuntimeException("Inventory not found"));
            Optional<InventoryReservation> latestReservation =
                    findReservation(latest, request.getCheckoutId());
            if (latestReservation.isEmpty()
                    || !"COMMITTED".equals(latestReservation.get().getStatus())) {
                throw new RuntimeException("Inventory reservation could not be committed");
            }
        }
    }

    private void validateReservationRequest(InventoryReservationRequest request) {
        if (request.getCheckoutId() == null
                || !request.getCheckoutId().matches("[A-Za-z0-9_-]{8,128}")) {
            throw new RuntimeException("A valid checkout ID is required");
        }
        if (request.getQuantity() < 1) {
            throw new RuntimeException("Quantity must be at least 1");
        }
    }

    private Optional<InventoryReservation> findReservation(
            Inventory inventory, String checkoutId) {
        if (inventory.getReservations() == null) {
            return Optional.empty();
        }
        return inventory.getReservations().stream()
                .filter(reservation -> checkoutId.equals(reservation.getCheckoutId()))
                .findFirst();
    }

    private InventoryResponse toInventoryResponse(Inventory inventory) {
        InventoryResponse response = new InventoryResponse();
        response.setInventoryId(inventory.getId());
        response.setWarehouseId(inventory.getWarehouse());
        response.setProductId(inventory.getProduct());
        response.setStock(inventory.getStock());
        productRepository.findById(inventory.getProduct())
                .ifPresent(product -> {
                    response.setProductName(product.getName());
                    response.setCategory(product.getCategory());
                });

        warehouseRepository.findById(inventory.getWarehouse())
                .ifPresent(warehouse -> {
                    response.setWarehouseName(warehouse.getName());
                });
        return response;
    }

        /*
        ==================================
        ADD STOCK BACK TO INVENTORY
        (AFTER ORDER CANCELLATION)
        ==================================
        */

        public void addStock(

                String warehouseId,

                String productId,

                int stock

        ){

        /*
        ==============================
        Find Inventory
        ==============================
        */

        Inventory inventory = inventoryRepository

                .findByWarehouseAndProduct(

                        warehouseId,

                        productId

                )

                .orElseThrow(

                        () -> new RuntimeException(

                                "Inventory not found"

                        )

                );

        /*
        ==============================
        Increase Stock
        ==============================
        */

        inventory.setStock(

                inventory.getStock() + stock

        );

        /*
        ==============================
        Save Inventory
        ==============================
        */

        inventoryRepository.save(

                inventory

        );

        }
}