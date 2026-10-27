package com.supplychain.security;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.supplychain.controller.InventoryController;
import com.supplychain.dto.InventoryReservationRequest;
import com.supplychain.dto.InventoryResponse;
import com.supplychain.repository.WarehouseRepository;
import com.supplychain.service.InventoryService;
import java.security.SecureRandom;
import java.util.Base64;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class InternalServiceAuthenticationFilterTest {

    private static final String TOKEN = generateToken();

    private static String generateToken() {
        byte[] secret = new byte[32];
        new SecureRandom().nextBytes(secret);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
    }

    @Mock
    private InventoryService inventoryService;
    @Mock
    private WarehouseRepository warehouseRepository;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        InventoryController controller = new InventoryController(
                inventoryService, warehouseRepository);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .addFilters(new InternalServiceAuthenticationFilter(TOKEN))
                .build();
    }

    @Test
    void validCredentialAllowsInventoryRequest() throws Exception {
        when(inventoryService.reserveInventory(any())).thenReturn(new InventoryResponse());
        InventoryReservationRequest request = new InventoryReservationRequest();
        request.setCheckoutId("checkout-12345678");
        request.setWarehouseId("warehouse-id");
        request.setProductId("product-id");
        request.setQuantity(1);

        mockMvc.perform(post("/api/inventory/reserve")
                        .header(InternalServiceAuthenticationFilter.HEADER_NAME, TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(new ObjectMapper().writeValueAsBytes(request)))
                .andExpect(status().isOk());

        verify(inventoryService).reserveInventory(any());
    }

    @Test
    void missingInvalidMalformedAndRepeatedCredentialsAreRejectedBeforeMutation() throws Exception {
        String requestBody = """
                {"checkoutId":"checkout-12345678","warehouseId":"warehouse-id",
                 "productId":"product-id","quantity":1}
                """;
        mockMvc.perform(post("/api/inventory/reserve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/inventory/reserve")
                        .header(InternalServiceAuthenticationFilter.HEADER_NAME, "invalid")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/inventory/reserve")
                        .header(InternalServiceAuthenticationFilter.HEADER_NAME, "B".repeat(43))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/inventory/reserve")
                        .header(InternalServiceAuthenticationFilter.HEADER_NAME, "A".repeat(42))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/inventory/reserve")
                        .header(InternalServiceAuthenticationFilter.HEADER_NAME, "A".repeat(42) + "B")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/inventory/reserve")
                        .header(InternalServiceAuthenticationFilter.HEADER_NAME, TOKEN + "=")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/inventory/reserve")
                        .header(InternalServiceAuthenticationFilter.HEADER_NAME, "A".repeat(200))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/inventory/reserve")
                        .header(InternalServiceAuthenticationFilter.HEADER_NAME, TOKEN, TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestBody))
                .andExpect(status().isUnauthorized());

        verifyNoInteractions(inventoryService, warehouseRepository);
    }

    @Test
    void protectsRootReadAndTestRoutesAsWellAsMutations() throws Exception {
        mockMvc.perform(get("/api/inventory"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/inventory/test/warehouses"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(inventoryService, warehouseRepository);
    }

    @Test
    void missingOrMalformedConfiguredSecretFailsStartup() {
        assertThrows(IllegalStateException.class,
                () -> new InternalServiceAuthenticationFilter(""));
        assertThrows(IllegalStateException.class,
                () -> new InternalServiceAuthenticationFilter("A".repeat(42)));
        assertThrows(IllegalStateException.class,
                () -> new InternalServiceAuthenticationFilter("A".repeat(42) + "B"));
        assertThrows(IllegalStateException.class,
                () -> new InternalServiceAuthenticationFilter("too-short"));
    }
}
