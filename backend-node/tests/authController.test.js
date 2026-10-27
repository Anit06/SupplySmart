const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const bcrypt = require("bcryptjs");
const User = require("../src/models/User");
const authController = require("../src/controllers/authController");

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

const restoreEnvironmentVariable = (name, value) => {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
};

test("login fails closed before credential lookup when JWT_SECRET is missing", async () => {
    const previousSecret = process.env.JWT_SECRET;
    const originalFindOne = User.findOne;
    let lookupCount = 0;
    User.findOne = async () => {
        lookupCount += 1;
        return null;
    };
    delete process.env.JWT_SECRET;

    try {
        const response = createResponse();
        await authController.login({ body: {} }, response);

        assert.equal(response.statusCode, 503);
        assert.equal(response.body.message, "Authentication is not configured");
        assert.equal(lookupCount, 0);
    } finally {
        User.findOne = originalFindOne;
        restoreEnvironmentVariable("JWT_SECRET", previousSecret);
    }
});

test("login reaches password validation when JWT_SECRET is configured", async () => {
    const previousSecret = process.env.JWT_SECRET;
    const originalFindOne = User.findOne;
    const originalCompare = bcrypt.compare;
    const email = "existing-user@example.test";
    let lookup;
    let passwordCheck;
    process.env.JWT_SECRET = crypto.randomBytes(48).toString("base64url");
    User.findOne = async (query) => {
        lookup = query;
        return { password: "stored-password-hash" };
    };
    bcrypt.compare = async (password, hash) => {
        passwordCheck = { password, hash };
        return false;
    };

    try {
        const response = createResponse();
        const password = "incorrect-password";
        await authController.login({ body: { email, password } }, response);

        assert.deepEqual(lookup, { email });
        assert.deepEqual(passwordCheck, { password, hash: "stored-password-hash" });
        assert.equal(response.statusCode, 401);
        assert.equal(response.body.message, "Invalid Password");
    } finally {
        User.findOne = originalFindOne;
        bcrypt.compare = originalCompare;
        restoreEnvironmentVariable("JWT_SECRET", previousSecret);
    }
});
