
import express from "express";
import cors from "cors";
import "dotenv/config";

import {
  connectToDatabase,
  getCollection,
} from "./config/database.js";

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

// CORS
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Stripe Webhook MUST be before express.json()
app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookRoutes
);

// JSON parser for all other routes
app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.send("Rentora Server is Running!");
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Rentora API is running",
    database: "Connected",
  });
});


app.use("/api/equipment", equipmentRoutes);


app.use("/api/rentals", rentalRoutes);

// Admin Equipment API
app.use("/api/admin/equipment", adminEquipmentRoutes);

// Owner Rental API
app.use("/api/owner/rentals", ownerRentalRoutes);

// Payment API
app.use("/api/payments", paymentRoutes);

// Favorites API (customer)
app.use("/api/favorites", favoriteRoutes);

// Profile API (any authenticated user)
app.use("/api/profile", profileRoutes);

// User management API (admin)
app.use("/api/users", userRoutes);
// Legacy alias so older clients keep working
app.use("/users", userRoutes);

// Admin analytics + rentals + equipment management
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

// Start server
async function startServer() {
  try {
    await connectToDatabase();
    console.log(
  "Stripe webhook secret loaded:",
  Boolean(process.env.STRIPE_WEBHOOK_SECRET)
);

    // Initialize Better Auth after database connection
    await import("./config/auth.js");

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

    app.listen(port, () => {
      console.log(`Rentora server running on port ${port}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();
