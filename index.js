
import express from "express";
import cors from "cors";
import "dotenv/config";

import {
  connectToDatabase,
  getCollection,
  pingDatabase,
} from "./config/database.js";
import { initializeAuth } from "./config/auth.js";

import equipmentRoutes from "./routes/equipment.routes.js";
import rentalRoutes from "./routes/rental.routes.js";
import adminEquipmentRoutes from "./routes/admin-equipment.routes.js";
import ownerRentalRoutes from "./routes/owner-rental.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import stripeWebhookRoutes from "./routes/stripe-webhook.routes.js";
import favoriteRoutes from "./routes/favorite.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import ownerRoutes from "./routes/owner.routes.js";
import uploadsRoutes from "./routes/uploads.routes.js";

const app = express();
const port = process.env.PORT || 5000;

/**
 * Origins allowed to call this API directly with credentials.
 *
 * `CLIENT_URL` (optionally `CORS_ORIGINS`) may hold several comma-separated
 * origins, e.g. "https://app.example.com,https://preview.example.com".
 * Falls back to the local frontend so development keeps working out of the
 * box. In production the browser normally reaches this API through the
 * frontend's same-origin `/api/backend` proxy, so CORS is a safety net for
 * deployments that call it cross-origin instead.
 */
function resolveAllowedOrigins() {
  const configured = [process.env.CLIENT_URL, process.env.CORS_ORIGINS]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return configured.length > 0 ? configured : ["http://localhost:3000"];
}

// CORS
app.use(
  cors({
    origin: resolveAllowedOrigins(),
    credentials: true,
  })
);

// Root route
app.get("/", (req, res) => {
  res.send("Rentora Server is Running!");
});

// Health check — verifies real database connectivity
app.get("/health", async (req, res) => {
  try {
    await pingDatabase();

    res.status(200).json({
      success: true,
      message: "Rentora API is running",
      database: "Connected",
    });
  } catch (error) {
    console.error("Health check failed:", error);

    res.status(503).json({
      success: false,
      message: "Rentora API is running",
      database: "Disconnected",
      error: error.message,
    });
  }
});

// Ensure MongoDB and Better Auth are initialized before any route that
// needs them (including the Stripe webhook below). On Vercel this also
// replaces app.listen(): the first request triggers initialization and
// every later request reuses the cached result.
app.use((req, res, next) => {
  initializeApp()
    .then(() => next())
    .catch((error) => next(error));
});

// Stripe Webhook MUST be before express.json()
app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookRoutes
);

// JSON parser for all other routes
app.use(express.json());


app.use("/api/equipment", equipmentRoutes);


app.use("/api/rentals", rentalRoutes);


app.use("/api/admin/equipment", adminEquipmentRoutes);


app.use("/api/owner/rentals", ownerRentalRoutes);


app.use("/api/payments", paymentRoutes);


app.use("/api/favorites", favoriteRoutes);

app.use("/api/profile", profileRoutes);


app.use("/api/users", userRoutes);

app.use("/users", userRoutes);

app.use("/api/admin", adminRoutes);

// Owner analytics
app.use("/api/owner", ownerRoutes);

app.use("/api/uploads", uploadsRoutes);

// 404 handler (JSON, not HTML)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  res.status(err.status || 500).json({
    success: false,
    message:
      err.status && err.status < 500
        ? err.message
        : "Internal server error",
  });
});

// Cached initialization: MongoDB + Better Auth + indexes, run once per
// server instance. On failure the cache is cleared so the next request
// retries instead of failing forever.
let initializationPromise = null;

function initializeApp() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await connectToDatabase();

      console.log(
        "Stripe webhook secret loaded:",
        Boolean(process.env.STRIPE_WEBHOOK_SECRET)
      );

      // Initialize Better Auth after the database connection
      await initializeAuth();

      getCollection("user");
      getCollection("equipment");
      getCollection("rental");

      const paymentCollection = getCollection("payment");

      await paymentCollection.createIndex(
        { stripeSessionId: 1 },
        { unique: true }
      );

      getCollection("favorite");
      getCollection("review");
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}

// Start server
async function startServer() {
  try {
    await initializeApp();

    // Vercel manages its own process — app.listen() must not run there
    if (process.env.VERCEL) {
      console.log("Vercel environment detected — app.listen() skipped.");
      return;
    }

    app.listen(port, () => {
      console.log(`Rentora server running on port ${port}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);

    // Only exit outside Vercel: on Vercel the initialization middleware
    // retries on the next request, so a cold-start failure is recoverable.
    if (!process.env.VERCEL) {
      process.exit(1);
    }
  }
}

startServer();
export default app

