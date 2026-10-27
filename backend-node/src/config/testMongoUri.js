const EXPECTED_TEST_DATABASE = "supply_chain_test";

const getSafeMongoTestUri = (uri = process.env.MONGO_TEST_URI) => {
    if (!uri) {
        throw new Error("MONGO_TEST_URI must point to the dedicated local test database");
    }

    let parsed;
    try {
        parsed = new URL(uri);
    } catch {
        throw new Error("MONGO_TEST_URI is not a valid MongoDB URI");
    }

    const database = parsed.pathname.replace(/^\/+/, "");
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (
        !["mongodb:", "mongodb+srv:"].includes(parsed.protocol)
        || parsed.protocol !== "mongodb:"
        || !localHosts.has(parsed.hostname)
        || parsed.username
        || parsed.password
        || database !== EXPECTED_TEST_DATABASE
    ) {
        throw new Error(
            `MongoDB integration tests are restricted to an unauthenticated local MongoDB database named ${EXPECTED_TEST_DATABASE}`
        );
    }

    return uri;
};

module.exports = { getSafeMongoTestUri, EXPECTED_TEST_DATABASE };
