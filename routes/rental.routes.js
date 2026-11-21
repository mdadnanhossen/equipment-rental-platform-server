
import express from "express";
import { ObjectId } from "mongodb";

import { getCollection } from "../config/database.js";
import { validateRentalPayload } from "../models/rental.model.js";

import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(verifyAuth, requireRole("customer"));

// GET: Customer's own rentals
router.get("/my-rentals", async (req, res) => {
  try {
    const rentalCollection = getCollection("rental");

    const rentals = await rentalCollection
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      message: "Rentals fetched successfully",
      data: rentals,
    });
  } catch (error) {
    console.error("Fetching rentals error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch rentals",
    });
  }
});

// PATCH: Update customer's pending rental request
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate: startDateInput, endDate: endDateInput } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rental ID",
      });
    }

    const validation = validateRentalPayload({
      equipmentId: "existing",
      startDate: startDateInput,
      endDate: endDateInput,
    });

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.errors.join(", "),
      });
    }

    const startDate = new Date(startDateInput);
    const endDate = new Date(endDateInput);

    const startDay = Date.UTC(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth(),
      startDate.getUTCDate()
    );

    const endDay = Date.UTC(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth(),
      endDate.getUTCDate()
    );

    const today = new Date();
    const todayDay = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    if (startDay < todayDay) {
      return res.status(400).json({
        success: false,
        message: "Start date cannot be in the past",
      });
    }

    if (endDay <= startDay) {
      return res.status(400).json({
        success: false,
        message: "End date must be after start date",
      });
    }

    const rentalCollection = getCollection("rental");
    const equipmentCollection = getCollection("equipment");

    const rental = await rentalCollection.findOne({
      _id: new ObjectId(id),
      customerId: req.user.id,
      status: "pending",
    });

    if (!rental) {
      return res.status(404).json({
        success: false,
        message: "Pending rental request not found",
      });
    }

    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(rental.equipmentId),
      status: "approved",
      availability: "available",
    });

    if (!equipment) {
      return res.status(400).json({
        success: false,
        message: "Equipment is not available",
      });
    }

    const rentalDays = (endDay - startDay) / 86400000;

    const conflictingRental = await rentalCollection.findOne({
      _id: { $ne: new ObjectId(id) },
      equipmentId: rental.equipmentId,
      status: { $in: ["pending", "approved", "active"] },
      startDate: { $lt: new Date(endDay).toISOString() },
      endDate: { $gt: new Date(startDay).toISOString() },
    });

    if (conflictingRental) {
      return res.status(409).json({
        success: false,
        message: "Equipment is already requested for these dates",
      });
    }

    const totalAmount = rentalDays * equipment.pricePerDay;

    await rentalCollection.updateOne(
      {
        _id: new ObjectId(id),
        customerId: req.user.id,
        status: "pending",
      },
      {
        $set: {
          startDate: new Date(startDay).toISOString(),
          endDate: new Date(endDay).toISOString(),
          rentalDays,
          pricePerDay: equipment.pricePerDay,
          securityDeposit: equipment.securityDeposit || 0,
          totalAmount,
          updatedAt: new Date(),
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Rental request updated successfully",
    });
  } catch (error) {
    console.error("Rental update error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update rental request",
    });
  }
});


// PATCH: Cancel customer's pending rental request
router.patch("/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rental ID",
      });
    }

    const rentalCollection = getCollection("rental");

    const result = await rentalCollection.updateOne(
      {
        _id: new ObjectId(id),
        customerId: req.user.id,
        status: "pending",
      },
      {
        $set: {
          status: "cancelled",
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Pending rental request not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Rental request cancelled successfully",
    });
  } catch (error) {
    console.error("Rental cancellation error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to cancel rental request",
    });
  }
});


// POST: Create rental request
router.post("/", async (req, res) => {
  try {
    const validation = validateRentalPayload(req.body);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.errors.join(", "),
      });
    }

    const { equipmentId, startDate: startInput, endDate: endInput } =
      req.body;

    if (!ObjectId.isValid(equipmentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    const startDate = new Date(startInput);
    const endDate = new Date(endInput);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid rental dates",
      });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (startDate < now) {
      return res.status(400).json({
        success: false,
        message: "Start date cannot be in the past",
      });
    }

    if (endDate <= startDate) {
      return res.status(400).json({
        success: false,
        message: "End date must be after start date",
      });
    }

    const days = Math.ceil(
      (endDate.getTime() - startDate.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    const equipmentCollection = getCollection("equipment");
    const rentalCollection = getCollection("rental");

    const equipment = await equipmentCollection.findOne({
      _id: new ObjectId(equipmentId),
      status: "approved",
      availability: "available",
    });

    if (!equipment) {
      return res.status(404).json({
        success: false,
        message: "Equipment is not available for rental",
      });
    }

    if (String(equipment.ownerId) === String(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: "You cannot rent your own equipment",
      });
    }

    // Check overlapping rental requests
    const conflictingRental = await rentalCollection.findOne({
      equipmentId: equipment._id.toString(),
      status: { $in: ["pending", "approved", "active"] },
      startDate: { $lt: endDate.toISOString() },
      endDate: { $gt: startDate.toISOString() },
    });

    if (conflictingRental) {
      return res.status(409).json({
        success: false,
        message: "Equipment is already booked for these dates",
      });
    }

    const totalAmount = equipment.pricePerDay * days;

    const rental = {
      equipmentId: equipment._id.toString(),
      equipmentTitle: equipment.title,
      equipmentImage: equipment.images?.[0]?.url || "",

      customerId: req.user.id,
      customerName: req.user.name,
      customerEmail: req.user.email,

      ownerId: equipment.ownerId,
      ownerName: equipment.ownerName,

      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),

      rentalDays: days,
      pricePerDay: equipment.pricePerDay,
      securityDeposit: equipment.securityDeposit || 0,
      totalAmount,

      status: "pending",
      paymentStatus: "unpaid",

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await rentalCollection.insertOne(rental);

    return res.status(201).json({
      success: true,
      message: "Rental request submitted successfully",
      data: {
        ...rental,
        _id: result.insertedId,
      },
    });
  } catch (error) {
    console.error("Creating rental error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create rental request",
    });
  }
});

export default router;
