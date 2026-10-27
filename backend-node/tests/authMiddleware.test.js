const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../src/middleware/authMiddleware");
const roleMiddleware = require("../src/middleware/roleMiddleware");

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
  },
});

test("authentication fails closed when JWT_SECRET is not configured", () => {
  const previousSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  const response = createResponse();
  let nextCalled = false;

  try {
    authMiddleware({ headers: {} }, response, () => {
      nextCalled = true;
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.success, false);
    assert.equal(nextCalled, false);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }
});

test("authentication accepts a valid bearer token and rejects malformed credentials", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret";

  try {
    const token = jwt.sign({ id: "user-1", role: "shopkeeper" }, "test-secret");
    let authenticated = false;
    authMiddleware(
      { headers: { authorization: `Bearer ${token}` } },
      createResponse(),
      () => {
        authenticated = true;
      },
    );
    assert.equal(authenticated, true);

    for (const authorization of [`Basic ${token}`, `Bearer ${token} extra`]) {
      const response = createResponse();
      authMiddleware({ headers: { authorization } }, response, () => {
        assert.fail("malformed credentials must not authenticate");
      });
      assert.equal(response.statusCode, 401);
    }
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }
});

test("admin authorization accepts the administrative_user alias while rejecting non-admin roles", () => {
  let nextCalled = false;
  roleMiddleware("admin")(
    { user: { role: "administrative_user" } },
    createResponse(),
    () => {
      nextCalled = true;
    },
  );
  assert.equal(nextCalled, true);

  const response = createResponse();
  roleMiddleware("admin")(
    { user: { role: "user" } },
    response,
    () => {
      assert.fail("non-admin users must not pass admin authorization");
    },
  );
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { success: false, message: "Access Denied" });
});
