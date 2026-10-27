package com.supplychain.service;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;

import org.bson.Document;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.data.mongodb.core.query.UpdateDefinition;

import com.mongodb.client.result.UpdateResult;
import com.supplychain.dto.InventoryReservationRequest;
import com.supplychain.model.Inventory;
import com.supplychain.model.InventoryReservation;
import com.supplychain.repository.InventoryRepository;
import com.supplychain.repository.ProductHoldingRepository;
import com.supplychain.repository.ProductRepository;
import com.supplychain.repository.WarehouseRepository;

@ExtendWith(MockitoExtension.class)
class InventoryServiceTest {

    @Mock
    private InventoryRepository inventoryRepository;
    @Mock
    private ProductRepository productRepository;
    @Mock
    private WarehouseRepository warehouseRepository;
    @Mock
    private ProductHoldingRepository productHoldingRepository;
    @Mock
    private MongoTemplate mongoTemplate;

    private InventoryService inventoryService;

    @BeforeEach
    void setUp() {
        inventoryService = new InventoryService(
                inventoryRepository,
                productRepository,
                warehouseRepository,
                productHoldingRepository,
                mongoTemplate);
    }

    @Test
    void reserveUsesOneConditionalAtomicMongoUpdate() {
        Inventory inventory = new Inventory();
        inventory.setId("inventory-1");
        inventory.setWarehouse("warehouse-1");
        inventory.setProduct("product-1");
        inventory.setStock(1);
        when(inventoryRepository.findByWarehouseAndProduct("warehouse-1", "product-1"))
                .thenReturn(Optional.of(inventory));
        UpdateResult result = mock(UpdateResult.class);
        when(result.getMatchedCount()).thenReturn(1L);
        when(mongoTemplate.updateFirst(
                any(Query.class), any(UpdateDefinition.class), eq(Inventory.class)))
                .thenReturn(result);

        InventoryReservationRequest request = request();
        inventoryService.reserveInventory(request);

        ArgumentCaptor<Query> queryCaptor = ArgumentCaptor.forClass(Query.class);
        ArgumentCaptor<Update> updateCaptor = ArgumentCaptor.forClass(Update.class);
        verify(mongoTemplate).updateFirst(
                queryCaptor.capture(), updateCaptor.capture(), eq(Inventory.class));

        String queryJson = queryCaptor.getValue().getQueryObject().toJson();
        Document update = updateCaptor.getValue().getUpdateObject();
        assertTrue(queryJson.replaceAll("\\s", "").contains("\"stock\":{\"$gte\":1}"));
        assertTrue(queryJson.contains("\"reservations.checkoutId\""));
        assertTrue(update.toJson().replaceAll("\\s", "").contains("\"$inc\":{\"stock\":-1}"));
        assertTrue(update.toJson().contains("\"reservations\""));
    }

    @Test
    void reserveRejectsWhenAtomicStockPredicateDoesNotMatch() {
        Inventory inventory = new Inventory();
        inventory.setWarehouse("warehouse-1");
        inventory.setProduct("product-1");
        inventory.setStock(0);
        when(inventoryRepository.findByWarehouseAndProduct("warehouse-1", "product-1"))
                .thenReturn(Optional.of(inventory));
        UpdateResult result = mock(UpdateResult.class);
        when(result.getMatchedCount()).thenReturn(0L);
        when(mongoTemplate.updateFirst(
                any(Query.class), any(UpdateDefinition.class), eq(Inventory.class)))
                .thenReturn(result);

        assertThrows(RuntimeException.class,
                () -> inventoryService.reserveInventory(request()));
    }

    @Test
    void duplicateReservationDoesNotDecrementStockAgain() {
        Inventory inventory = new Inventory();
        inventory.setWarehouse("warehouse-1");
        inventory.setProduct("product-1");
        inventory.setStock(0);
        inventory.getReservations().add(
                new InventoryReservation("checkout-test-01", 1, "RESERVED"));
        when(inventoryRepository.findByWarehouseAndProduct("warehouse-1", "product-1"))
                .thenReturn(Optional.of(inventory));
        when(productRepository.findById("product-1")).thenReturn(Optional.empty());
        when(warehouseRepository.findById("warehouse-1")).thenReturn(Optional.empty());

        inventoryService.reserveInventory(request());

        verifyNoInteractions(mongoTemplate);
    }

    @Test
    void duplicateCommitDoesNotPerformAnotherReservationUpdate() {
        Inventory inventory = new Inventory();
        inventory.setWarehouse("warehouse-1");
        inventory.setProduct("product-1");
        inventory.getReservations().add(
                new InventoryReservation("checkout-test-01", 1, "COMMITTED"));
        when(inventoryRepository.findByWarehouseAndProduct("warehouse-1", "product-1"))
                .thenReturn(Optional.of(inventory));

        inventoryService.commitReservation(request());

        verifyNoInteractions(mongoTemplate);
    }

    @Test
    void duplicateReleaseDoesNotReturnStockTwice() {
        Inventory inventory = new Inventory();
        inventory.setWarehouse("warehouse-1");
        inventory.setProduct("product-1");
        inventory.getReservations().add(
                new InventoryReservation("checkout-test-01", 1, "RELEASED"));
        when(inventoryRepository.findByWarehouseAndProduct("warehouse-1", "product-1"))
                .thenReturn(Optional.of(inventory));

        inventoryService.releaseReservation(request());

        verifyNoInteractions(mongoTemplate);
    }

    @Test
    void releaseCannotRestoreStockForACommittedReservation() {
        Inventory inventory = new Inventory();
        inventory.setWarehouse("warehouse-1");
        inventory.setProduct("product-1");
        inventory.setStock(0);
        inventory.getReservations().add(
                new InventoryReservation("checkout-test-01", 1, "COMMITTED"));
        when(inventoryRepository.findByWarehouseAndProduct("warehouse-1", "product-1"))
                .thenReturn(Optional.of(inventory));

        assertThrows(RuntimeException.class,
                () -> inventoryService.releaseReservation(request()));
        verifyNoInteractions(mongoTemplate);
    }

    @Test
    void releaseUsesOnlyReservedStateAsItsAtomicPredicate() {
        Inventory inventory = new Inventory();
        inventory.setWarehouse("warehouse-1");
        inventory.setProduct("product-1");
        inventory.setStock(0);
        inventory.getReservations().add(
                new InventoryReservation("checkout-test-01", 1, "RESERVED"));
        when(inventoryRepository.findByWarehouseAndProduct("warehouse-1", "product-1"))
                .thenReturn(Optional.of(inventory));
        UpdateResult result = mock(UpdateResult.class);
        when(result.getMatchedCount()).thenReturn(1L);
        when(mongoTemplate.updateFirst(
                any(Query.class), any(UpdateDefinition.class), eq(Inventory.class)))
                .thenReturn(result);

        inventoryService.releaseReservation(request());

        ArgumentCaptor<Query> queryCaptor = ArgumentCaptor.forClass(Query.class);
        ArgumentCaptor<Update> updateCaptor = ArgumentCaptor.forClass(Update.class);
        verify(mongoTemplate).updateFirst(
                queryCaptor.capture(), updateCaptor.capture(), eq(Inventory.class));
        String queryJson = queryCaptor.getValue().getQueryObject().toJson();
        String updateJson = updateCaptor.getValue().getUpdateObject().toJson();
        assertTrue(queryJson.replaceAll("\\s", "").contains("\"status\":\"RESERVED\""));
        assertTrue(!queryJson.contains("COMMITTED"));
        assertTrue(updateJson.replaceAll("\\s", "").contains("\"$inc\":{\"stock\":1}"));
        assertTrue(updateJson.contains("RELEASED"));
    }

    @Test
    void releaseRejectsWhenReservationWasCommittedAfterInitialRead() {
        Inventory reserved = new Inventory();
        reserved.setWarehouse("warehouse-1");
        reserved.setProduct("product-1");
        reserved.getReservations().add(
                new InventoryReservation("checkout-test-01", 1, "RESERVED"));
        Inventory committed = new Inventory();
        committed.setWarehouse("warehouse-1");
        committed.setProduct("product-1");
        committed.getReservations().add(
                new InventoryReservation("checkout-test-01", 1, "COMMITTED"));
        when(inventoryRepository.findByWarehouseAndProduct("warehouse-1", "product-1"))
                .thenReturn(Optional.of(reserved), Optional.of(committed));
        UpdateResult result = mock(UpdateResult.class);
        when(result.getMatchedCount()).thenReturn(0L);
        when(mongoTemplate.updateFirst(
                any(Query.class), any(UpdateDefinition.class), eq(Inventory.class)))
                .thenReturn(result);

        assertThrows(RuntimeException.class,
                () -> inventoryService.releaseReservation(request()));
        verify(mongoTemplate).updateFirst(
                any(Query.class), any(UpdateDefinition.class), eq(Inventory.class));
    }

    private InventoryReservationRequest request() {
        InventoryReservationRequest request = new InventoryReservationRequest();
        request.setCheckoutId("checkout-test-01");
        request.setWarehouseId("warehouse-1");
        request.setProductId("product-1");
        request.setQuantity(1);
        return request;
    }
}
