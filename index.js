
import express from "express";
import cors from "cors";
import "dotenv/config";

import {
  connectToDatabase,
  getCollection,
} from "./config/database.js";

import {
  verifyAuth,
  requireRole,
} from "./middleware/auth.middleware.js";

import equipmentRoutes from "./routes/equipment.routes.js";
import rentalRoutes from "./routes/rental.routes.js";
import adminEquipmentRoutes from "./routes/admin-equipment.routes.js";
import ownerRentalRoutes from "./routes/owner-rental.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import stripeWebhookRoutes from "./routes/stripe-webhook.routes.js";

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

// Equipment API
app.use("/api/equipment", equipmentRoutes);

// Rental API
app.use("/api/rentals", rentalRoutes);

// Admin Equipment API
app.use("/api/admin/equipment", adminEquipmentRoutes);

// Owner Rental API
app.use("/api/owner/rentals", ownerRentalRoutes);

// Payment API
app.use("/api/payments", paymentRoutes);

// Get all users
app.get(
  "/users",
  verifyAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const userCollection = getCollection("user");

      const users = await userCollection
        .find({})
        .project({
          name: 1,
          email: 1,
          role: 1,
          image: 1,
        })
        .toArray();

      res.status(200).json({
        success: true,
        message: "Users fetched successfully",
        data: users,
      });
    } catch (error) {
      console.error("Users fetching error:", error);

      res.status(500).json({
        success: false,
        message: "Failed to fetch users",
      });
    }
  }
);

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
