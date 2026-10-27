const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/User");
const Product = require("../src/models/Product");
const ProductPrice = require("../src/models/ProductPrice");
const ShopkeeperDetails = require("../src/models/ShopkeeperDetails");
const javaService = require("../src/services/javaService");
const { getWarehouseCatalog } = require("../src/controllers/catalogController");

const createResponse = () => ({
    statusCode: null,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    }
});

const withCatalogMocks = async (javaCall, run) => {
    const originals = {
        userFindById: User.findById,
        shopkeeperFindOne: ShopkeeperDetails.findOne,
        productFindById: Product.findById,
        productPriceFindOne: ProductPrice.findOne,
        javaGetInventory: javaService.getInventoryByWarehouse
    };

    User.findById = async () => ({ role: "admin" });
    ShopkeeperDetails.findOne = async () => null;
    Product.findById = async () => null;
    ProductPrice.findOne = async () => null;
    javaService.getInventoryByWarehouse = javaCall;

    try {
        await run();
    } finally {
        User.findById = originals.userFindById;
        ShopkeeperDetails.findOne = originals.shopkeeperFindOne;
        Product.findById = originals.productFindById;
        ProductPrice.findOne = originals.productPriceFindOne;
        javaService.getInventoryByWarehouse = originals.javaGetInventory;
    }
};

test("catalog reports Java service configuration failures as unavailable, not internal errors", async () => {
    const serviceErrors = [
        {
            code: "JAVA_SERVICE_CONFIG_MISSING",
            message: "JAVA_SERVICE_URL is required"
        },
        {
            code: "JAVA_SERVICE_AUTH_CONFIG_INVALID",
            message: "JAVA_SERVICE_TOKEN must be a 32-byte-or-stronger base64url secret"
        }
    ];

    for (const serviceError of serviceErrors) {
        const response = createResponse();
        const request = {
            params: { warehouseId: "warehouse-id" },
            user: { id: "user-id" },
            requestId: "catalog-request"
        };

        await withCatalogMocks(async () => {
            throw Object.assign(
                new Error(serviceError.message),
                { code: serviceError.code }
            );
        }, async () => {
            await getWarehouseCatalog(request, response);
        });

        assert.equal(response.statusCode, 503);
        assert.deepEqual(response.body, {
            success: false,
            message: serviceError.message
        });
    }
});

test("catalog retains successful empty inventory responses", async () => {
    const response = createResponse();
    const request = {
        params: { warehouseId: "warehouse-id" },
        user: { id: "user-id" }
    };

    await withCatalogMocks(async (warehouseId) => {
        assert.equal(warehouseId, "warehouse-id");
        return { data: [] };
    }, async () => {
        await getWarehouseCatalog(request, response);
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
        success: true,
        totalProducts: 0,
        products: []
    });
});

test("catalog does not return raw database exception messages", async () => {
    const response = createResponse();
    const request = {
        params: { warehouseId: "warehouse-id" },
        user: { id: "user-id" }
    };

    await withCatalogMocks(async () => {
        throw new Error("database connection detail");
    }, async () => {
        await getWarehouseCatalog(request, response);
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
        success: false,
        message: "Unable to load product catalog"
    });
});
