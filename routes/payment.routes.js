
import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import "dotenv/config";

import { getCollection } from "../config/database.js";
import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(verifyAuth);

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is missing from environment variables");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:3000";

const CURRENCY = (
  process.env.STRIPE_CURRENCY || "bdt"
).toLowerCase();


// ============================================
// Helper: Format Payment Records
// ============================================

const formatPaymentRecords = async (payments) => {
  const rentalCollection = getCollection("rental");

  const rentalIds = payments
    .map((payment) => String(payment.rentalId))
    .filter((id) => ObjectId.isValid(id));

  const objectIds = rentalIds.map((id) => new ObjectId(id));

  const rentals = await rentalCollection
    .find({ _id: { $in: objectIds } })
    .toArray();

  const rentalMap = new Map(
    rentals.map((rental) => [
      rental._id.toString(),
      rental,
    ])
  );

  return payments.map((payment) => {
    const rental = rentalMap.get(String(payment.rentalId));

    return {
      _id: payment._id.toString(),
      rentalId: String(payment.rentalId),

      equipmentTitle: rental?.equipmentTitle || "Equipment",
      customerName: rental?.customerName || "Customer",
      customerEmail: rental?.customerEmail || "",
      ownerName: rental?.ownerName || "Owner",

      amount: payment.amount,
      currency: payment.currency || CURRENCY,
      paymentStatus: payment.paymentStatus,

      transactionId:
        payment.paymentIntentId ||
        payment.stripeSessionId ||
        null,

      paidAt: rental?.paidAt || payment.createdAt || null,
    };
  });
};


// ============================================
// GET: Customer Payment History
// GET /api/payments/history
// ============================================

router.get(
  "/history",
  requireRole("customer"),
  async (req, res) => {
    try {
      const paymentCollection = getCollection("payment");

      const payments = await paymentCollection
        .find({
          customerId: req.user.id,
        })
        .sort({ createdAt: -1 })
        .toArray();

      const history = await formatPaymentRecords(payments);

      return res.status(200).json({
        success: true,
        message: "Payment history fetched successfully",
        data: history,
      });
    } catch (error) {
      console.error("Payment history error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to fetch payment history",
      });
    }
  }
);


// ============================================
// GET: Owner Payment History
// GET /api/payments/owner/history
// ============================================

router.get(
  "/owner/history",
  requireRole("owner"),
  async (req, res) => {
    try {
      const rentalCollection = getCollection("rental");
      const paymentCollection = getCollection("payment");

      // Find rentals belonging to logged-in owner
      const rentals = await rentalCollection
        .find({
          ownerId: req.user.id,
        })
        .project({
          _id: 1,
        })
        .toArray();

      const rentalIds = rentals.map((rental) =>
        rental._id.toString()
      );

      if (rentalIds.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No payment records found",
          data: [],
        });
      }

      // Find payments for owner's rentals only
      const payments = await paymentCollection
        .find({
          rentalId: { $in: rentalIds },
          paymentStatus: "paid",
        })
        .sort({ createdAt: -1 })
        .toArray();

      const history = await formatPaymentRecords(payments);

      return res.status(200).json({
        success: true,
        message: "Owner payment history fetched successfully",
        data: history,
      });
    } catch (error) {
      console.error("Owner payment history error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to fetch owner payment history",
      });
    }
  }
);


// ============================================
// GET: Admin All Payment History
// GET /api/payments/admin/history
// ============================================

router.get(
  "/admin/history",
  requireRole("admin"),
  async (req, res) => {
    try {
      const paymentCollection = getCollection("payment");

      const payments = await paymentCollection
        .find({
          paymentStatus: "paid",
        })
        .sort({ createdAt: -1 })
        .toArray();

      const history = await formatPaymentRecords(payments);

      return res.status(200).json({
        success: true,
        message: "All payment records fetched successfully",
        data: history,
      });
    } catch (error) {
      console.error("Admin payment history error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to fetch all payment records",
      });
    }
  }
);


// ============================================
// GET: Payment Status
// GET /api/payments/session-status?session_id=cs_test_xxx
// ============================================

router.get(
  "/session-status",
  requireRole("customer"),
  async (req, res) => {
    try {
      const { session_id } = req.query;

      if (
        !session_id ||
        typeof session_id !== "string" ||
        !session_id.startsWith("cs_")
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid Checkout Session ID is required",
        });
      }

      const rentalCollection = getCollection("rental");
      const paymentCollection = getCollection("payment");

      const rental = await rentalCollection.findOne({
        stripeCheckoutSessionId: session_id,
        customerId: req.user.id,
      });

      if (!rental) {
        return res.status(404).json({
          success: false,
          message: "Payment session not found",
        });
      }

      const payment = await paymentCollection.findOne({
        stripeSessionId: session_id,
        customerId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        message: "Payment status fetched successfully",
        data: {
          rentalId: rental._id.toString(),
          equipmentTitle: rental.equipmentTitle,
          paymentStatus: rental.paymentStatus,
          rentalStatus: rental.status,
          amount: payment?.amount ?? rental.totalAmount,
          currency: payment?.currency ?? CURRENCY,
          paidAt: rental.paidAt || payment?.createdAt || null,
          transactionExists: Boolean(payment),
        },
      });
    } catch (error) {
      console.error("Payment status error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to fetch payment status",
      });
    }
  }
);


// ============================================
// POST: Create Stripe Checkout Session
// POST /api/payments/create-checkout-session
// ============================================

router.post(
  "/create-checkout-session",
  requireRole("customer"),
  async (req, res) => {
    let createdSessionId = null;

    try {
      const { rentalId } = req.body;

      if (!rentalId || !ObjectId.isValid(rentalId)) {
        return res.status(400).json({
          success: false,
          message: "Valid rental ID is required",
        });
      }

      const rentalCollection = getCollection("rental");
      const equipmentCollection = getCollection("equipment");

      // Find rental belonging to logged-in customer
      const rental = await rentalCollection.findOne({
        _id: new ObjectId(rentalId),
        customerId: req.user.id,
      });

      if (!rental) {
        return res.status(404).json({
          success: false,
          message: "Rental not found",
        });
      }

      // Only approved rentals can be paid
      if (rental.status !== "approved") {
        return res.status(400).json({
          success: false,
          message: "Only approved rentals can be paid",
        });
      }

      // Prevent duplicate payment
      if (rental.paymentStatus === "paid") {
        return res.status(409).json({
          success: false,
          message: "This rental has already been paid",
        });
      }

      if (rental.paymentStatus !== "unpaid") {
        return res.status(400).json({
          success: false,
          message: "This rental is not eligible for payment",
        });
      }

      // Validate equipment ID
      if (!ObjectId.isValid(rental.equipmentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid equipment information",
        });
      }

      // Verify equipment
      const equipment = await equipmentCollection.findOne({
        _id: new ObjectId(rental.equipmentId),
        status: "approved",
        availability: "available",
      });

      if (!equipment) {
        return res.status(400).json({
          success: false,
          message: "Equipment is no longer available",
        });
      }

      // Validate rental dates
      const startDate = new Date(rental.startDate);
      const endDate = new Date(rental.endDate);

      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime()) ||
        endDate <= startDate
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid rental dates",
        });
      }

      // Calculate rental amount on backend
      const rentalDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) /
          (1000 * 60 * 60 * 24)
      );

      const pricePerDay = Number(rental.pricePerDay);

      if (
        !Number.isFinite(pricePerDay) ||
        pricePerDay <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid rental price",
        });
      }

      // Quantity of units booked (legacy rentals default to 1).
      const rentalQuantity = Number.isInteger(rental.quantity)
        ? rental.quantity
        : 1;

      const totalAmount = rentalDays * pricePerDay * rentalQuantity;

      if (
        !Number.isSafeInteger(totalAmount) ||
        totalAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment amount",
        });
      }

      // BDT uses two decimal places in Stripe
      const stripeAmount = Math.round(totalAmount * 100);

      if (
        !Number.isSafeInteger(stripeAmount) ||
        stripeAmount <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid Stripe payment amount",
        });
      }

      // Reuse existing open Checkout Session
      if (rental.stripeCheckoutSessionId) {
        const existingSession =
          await stripe.checkout.sessions.retrieve(
            rental.stripeCheckoutSessionId
          );

        if (
          existingSession.status === "open" &&
          existingSession.url
        ) {
          return res.status(200).json({
            success: true,
            message: "Checkout session already exists",
            checkoutUrl: existingSession.url,
          });
        }

        if (existingSession.status === "complete") {
          return res.status(409).json({
            success: false,
            message: "Payment is being processed",
          });
        }

        // Previous session expired: prepare a new attempt
        if (existingSession.status === "expired") {
          const retryTime = new Date();

          await rentalCollection.updateOne(
            {
              _id: rental._id,
              customerId: req.user.id,
              paymentStatus: "unpaid",
            },
            {
              $set: {
                updatedAt: retryTime,
              },
            }
          );

          rental.updatedAt = retryTime;
        }
      }

      // Stable key for concurrent requests on the same rental version
      const checkoutVersion = rental.updatedAt
        ? new Date(rental.updatedAt).getTime()
        : rental.createdAt
          ? new Date(rental.createdAt).getTime()
          : rental._id.getTimestamp().getTime();

      const idempotencyKey =
        `rentora_checkout_${rental._id}_${checkoutVersion}`;

      // Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",

          ...(req.user.email
            ? { customer_email: req.user.email }
            : {}),

          client_reference_id: rental._id.toString(),

          line_items: [
            {
              price_data: {
                currency: CURRENCY,
                product_data: {
                  name: rental.equipmentTitle,
                  description: `${rentalDays} days equipment rental`,
                },
                unit_amount: stripeAmount,
              },
              quantity: 1,
            },
          ],

          metadata: {
            rentalId: rental._id.toString(),
            customerId: req.user.id,
          },

          success_url:
            `${CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,

          cancel_url:
            `${CLIENT_URL}/payment/cancel?rentalId=${rental._id}`,
        },
        {
          idempotencyKey,
        }
      );

      createdSessionId = session.id;

      // Save Checkout Session ID in MongoDB
      const updateResult = await rentalCollection.updateOne(
        {
          _id: rental._id,
          customerId: req.user.id,
          status: "approved",
          paymentStatus: "unpaid",
        },
        {
          $set: {
            rentalDays,
            totalAmount,
            stripeCheckoutSessionId: session.id,
            updatedAt: new Date(),
          },
        }
      );

      // If rental update fails, expire the unused session
      if (updateResult.modifiedCount !== 1) {
        await stripe.checkout.sessions.expire(session.id);

        return res.status(409).json({
          success: false,
          message: "Rental payment state changed. Please try again.",
        });
      }

      return res.status(201).json({
        success: true,
        message: "Stripe Checkout Session created successfully",
        checkoutUrl: session.url,
      });
    } catch (error) {
      console.error("Stripe Checkout Session error:", error);

      // Best-effort cleanup if a session was created but saving failed
      if (createdSessionId) {
        try {
          await stripe.checkout.sessions.expire(createdSessionId);
        } catch (expireError) {
          console.error(
            "Unable to expire unused Checkout Session:",
            expireError
          );
        }
      }

      return res.status(500).json({
        success: false,
        message: "Unable to create payment session",
      });
    }
  }
);


export default router;
