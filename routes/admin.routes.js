
import express from "express";
import { ObjectId } from "mongodb";

import { getCollection } from "../config/database.js";
import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(verifyAuth, requireRole("admin"));

const RENTAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "active",
  "completed",
  "cancelled",
];

const EQUIPMENT_STATUSES = ["pending", "approved", "rejected"];
const RENTAL_TYPES = ["daily", "weekly", "monthly"];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * GET /api/admin/analytics
 * Admin: platform-wide statistics computed from real data.
 */
router.get("/analytics", async (req, res) => {
  try {
    const userCollection = getCollection("user");
    const equipmentCollection = getCollection("equipment");
    const rentalCollection = getCollection("rental");
    const paymentCollection = getCollection("payment");

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      totalEquipment,
      pendingEquipment,
      approvedEquipment,
      rejectedEquipment,
      totalRentals,
      pendingRentals,
      approvedRentals,
      completedRentals,
      monthlyRentals,
      statusBreakdown,
      paidPayments,
      newUsersThisMonth,
    ] = await Promise.all([
      userCollection.countDocuments(),
      equipmentCollection.countDocuments(),
      equipmentCollection.countDocuments({ status: "pending" }),
      equipmentCollection.countDocuments({ status: "approved" }),
      equipmentCollection.countDocuments({ status: "rejected" }),
      rentalCollection.countDocuments(),
      rentalCollection.countDocuments({ status: "pending" }),
      rentalCollection.countDocuments({ status: "approved" }),
      rentalCollection.countDocuments({ status: "completed" }),
      rentalCollection.countDocuments({
        createdAt: { $gte: monthStart },
      }),
      rentalCollection
        .aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
        .toArray(),
      paymentCollection
        .find({ paymentStatus: "paid" })
        .project({ amount: 1 })
        .toArray(),
      userCollection.countDocuments({
        createdAt: { $gte: monthStart },
      }),
    ]);

    // Deduplicate by payment id so a session recorded twice never counts twice.
    const seen = new Set();
    let totalRevenue = 0;

    for (const payment of paidPayments) {
      const key = payment._id.toString();

      if (seen.has(key)) continue;
      seen.add(key);

      const amount = Number(payment.amount);

      if (Number.isFinite(amount)) {
        totalRevenue += amount;
      }
    }

    const rentalsByStatus = {};

    for (const entry of statusBreakdown) {
      rentalsByStatus[entry._id || "unknown"] = entry.count;
    }

    return res.status(200).json({
      success: true,
      message: "Admin analytics fetched successfully",
      data: {
        users: {
          total: totalUsers,
          newThisMonth: newUsersThisMonth,
        },
        equipment: {
          total: totalEquipment,
          pending: pendingEquipment,
          approved: approvedEquipment,
          rejected: rejectedEquipment,
        },
        rentals: {
          total: totalRentals,
          pending: pendingRentals,
          approved: approvedRentals,
          completed: completedRentals,
          thisMonth: monthlyRentals,
          byStatus: rentalsByStatus,
        },
        revenue: {
          total: Number(totalRevenue.toFixed(2)),
          paidTransactions: paidPayments.length,
        },
      },
    });
  } catch (error) {
    console.error("Admin analytics error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch admin analytics",
    });
  }
});

/**
 * GET /api/admin/rentals
 * Admin: monitor every rental on the platform.
 *
 * Optional filters: ?status= &search= &page= &limit=
 */
router.get("/rentals", async (req, res) => {
  try {
    const rentalCollection = getCollection("rental");

    const {
      status,
      search,
      page = "1",
      limit = "20",
    } = req.query;

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.min(50, Math.max(1, Number(limit) || 20));

    const filter = {};

    if (status) {
      if (!RENTAL_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status",
        });
      }

      filter.status = status;
    }

    if (search && typeof search === "string" && search.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), "i");

      filter.$or = [
        { equipmentTitle: regex },
        { customerName: regex },
        { customerEmail: regex },
        { ownerName: regex },
      ];
    }

    const [total, rentals] = await Promise.all([
      rentalCollection.countDocuments(filter),
      rentalCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageLimit)
        .limit(pageLimit)
        .toArray(),
    ]);

    return res.status(200).json({
      success: true,
      message: "Rentals fetched successfully",
      data: rentals.map((rental) => ({
        ...rental,
        quantity: Number.isInteger(rental.quantity) ? rental.quantity : 1,
        _id: rental._id.toString(),
      })),
      total,
      page: currentPage,
      totalPages: Math.ceil(total / pageLimit),
    });
  } catch (error) {
    console.error("Admin rentals fetch error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch rentals",
    });
  }
});

/**
 * PATCH /api/admin/rentals/:id/status
 * Admin: correct or override a booking status.
 */
router.patch("/rentals/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rental ID",
      });
    }

    if (!RENTAL_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    const rentalCollection = getCollection("rental");

    const result = await rentalCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Rental not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Rental status updated successfully",
      data: { id, status },
    });
  } catch (error) {
    console.error("Admin rental status update error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update rental status",
    });
  }
});

/**
 * PATCH /api/admin/equipment/:id
 * Admin: update any listing (including status overrides).
 */
router.patch("/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    const equipmentCollection = getCollection("equipment");

    const existing = await equipmentCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    const allowedFields = [
      "title",
      "description",
      "category",
      "brand",
      "model",
      "rentalType",
      "pricePerDay",
      "quantity",
      "rentalTerms",
      "securityDeposit",
      "condition",
      "images",
      "location",
      "availability",
      "status",
      "rejectionReason",
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    if (
      updates.status !== undefined &&
      !EQUIPMENT_STATUSES.includes(updates.status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    if (
      updates.rentalType !== undefined &&
      !RENTAL_TYPES.includes(updates.rentalType)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid rental type",
      });
    }

    if (
      updates.pricePerDay !== undefined &&
      (
        typeof updates.pricePerDay !== "number" ||
        !Number.isFinite(updates.pricePerDay) ||
        updates.pricePerDay <= 0
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "pricePerDay must be a positive number",
      });
    }

    if (
      updates.quantity !== undefined &&
      (!Number.isInteger(updates.quantity) || updates.quantity < 1)
    ) {
      return res.status(400).json({
        success: false,
        message: "quantity must be a whole number of 1 or more",
      });
    }

    for (const field of [
      "title",
      "description",
      "category",
      "brand",
      "model",
    ]) {
      if (typeof updates[field] === "string") {
        updates[field] = updates[field].trim();
      }
    }

    if (typeof updates.rentalTerms === "string") {
      updates.rentalTerms = updates.rentalTerms.trim();
    }

    // Admin edits to listing details send the listing back for review
    // unless the admin is explicitly setting the status.
    const contentFields = [
      "title",
      "description",
      "category",
      "rentalType",
      "pricePerDay",
      "images",
      "location",
    ];

    if (
      updates.status === undefined &&
      contentFields.some((field) => updates[field] !== undefined)
    ) {
      updates.status = "pending";
      updates.rejectionReason = "";
    }

    updates.updatedAt = new Date();

    const unsetFields = {
      pricePerWeek: "",
      pricePerMonth: "",
    };

    const result = await equipmentCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates, $unset: unsetFields },
      { returnDocument: "after" }
    );

    return res.status(200).json({
      success: true,
      message: "Equipment updated successfully",
      data: {
        ...result,
        rentalType: result.rentalType || "daily",
        quantity: Number.isInteger(result.quantity) ? result.quantity : 1,
        _id: result._id.toString(),
      },
    });
  } catch (error) {
    console.error("Admin equipment update error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update equipment",
    });
  }
});

/**
 * DELETE /api/admin/equipment/:id
 * Admin: remove any listing.
 */
router.delete("/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid equipment ID",
      });
    }

    const equipmentCollection = getCollection("equipment");

    const result = await equipmentCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Equipment not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Equipment deleted successfully",
    });
  } catch (error) {
    console.error("Admin equipment deletion error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete equipment",
    });
  }
});

export default router;
