
import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import "dotenv/config";

import { getCollection } from "../config/database.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post("/", async (req, res) => {
  const signature = req.headers["stripe-signature"];

  let event;

  // Verify Stripe webhook signature using the raw request body
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;

  try {
    if (session.payment_status !== "paid") {
      return res.status(200).json({
        received: true,
        message: "Payment is not completed yet",
      });
    }

    const rentalId = session.metadata?.rentalId;
    const customerId = session.metadata?.customerId;

    if (!rentalId || !ObjectId.isValid(rentalId) || !customerId) {
      return res.status(400).json({
        success: false,
        message: "Invalid rental metadata",
      });
    }

    const rentalCollection = getCollection("rental");
    const paymentCollection = getCollection("payment");

    const rental = await rentalCollection.findOne({
      _id: new ObjectId(rentalId),
      customerId,
      stripeCheckoutSessionId: session.id,
    });

    if (!rental) {
      throw new Error("Matching rental or Checkout Session not found");
    }

    const expectedAmount = Math.round(Number(rental.totalAmount) * 100);

    if (
      session.amount_total !== expectedAmount ||
      session.currency !== (process.env.STRIPE_CURRENCY || "bdt").toLowerCase()
    ) {
      throw new Error("Stripe payment amount or currency mismatch");
    }

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id || null;

    // Save payment once per Checkout Session
    await paymentCollection.updateOne(
      { stripeSessionId: session.id },
      {
        $setOnInsert: {
          stripeEventId: event.id,
          stripeSessionId: session.id,
          paymentIntentId,
          rentalId,
          customerId,
          amount: session.amount_total / 100,
          currency: session.currency,
          paymentStatus: "paid",
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    // Update rental only if it has not already been paid
    const updateResult = await rentalCollection.updateOne(
      {
        _id: new ObjectId(rentalId),
        customerId,
        stripeCheckoutSessionId: session.id,
        paymentStatus: "unpaid",
      },
      {
        $set: {
          paymentStatus: "paid",
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntentId,
          updatedAt: new Date(),
        },
      }
    );

    if (updateResult.modifiedCount === 0) {
      const alreadyPaid = await rentalCollection.findOne({
        _id: new ObjectId(rentalId),
        customerId,
        stripeCheckoutSessionId: session.id,
        paymentStatus: "paid",
      });

      if (!alreadyPaid) {
        throw new Error("Rental payment status could not be updated");
      }
    }

    console.log(`Payment completed for rental: ${rentalId}`);

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing error:", error);

    // A 500 response tells Stripe to retry the event
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed",
    });
  }
});

export default router;
