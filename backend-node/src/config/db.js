const mongoose = require("mongoose");
const { recordDatabaseFailure } = require("../services/observability");

mongoose.connection.on("disconnected", () => {
  recordDatabaseFailure();
  console.error(JSON.stringify({ event: "mongodb_disconnected" }));
});
mongoose.connection.on("error", (error) => {
  recordDatabaseFailure();
  console.error(JSON.stringify({
    event: "mongodb_connection_error",
    errorCode: String(error.code || error.name || "MONGODB_ERROR").slice(0, 80)
  }));
});

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
      throw Object.assign(new Error("MONGO_URI is required"), {
        code: "MONGO_URI_MISSING"
      });
    }

    await mongoose.connect(
      mongoUri,
      {
        maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) >= 1
          ? Number(process.env.MONGO_MAX_POOL_SIZE)
          : 20,
        serverSelectionTimeoutMS: 10_000
      }
    );

    console.log(
      "MongoDB Connected"
    );

  } catch (error) {
    recordDatabaseFailure();
    console.error(JSON.stringify({
      event: "mongodb_connection_failed",
      errorCode: String(error.code || error.name || "MONGODB_CONNECTION_ERROR").slice(0, 80)
    }));

    process.exit(1);

  }
};

module.exports = connectDB;