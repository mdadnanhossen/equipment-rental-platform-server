
import express from "express";

import { getCollection } from "../config/database.js";
import {
  verifyAuth,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = express.Router();

router.use(verifyAuth, requireRole("owner"));

/**
 * GET /api/owner/analytics
 * Owner: statistics computed from this owner's own equipment,
 * rentals and completed payments.
 */
router.get("/analytics", async (req, res) => {
  try {
    const equipmentCollection = getCollection("equipment");
    const rentalCollection = getCollection("rental");
    const paymentCollection = getCollection("payment");

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalEquipment,
      pendingEquipment,
      approvedEquipment,
      unavailableEquipment,
      totalRentals,
      pendingRentals,
      approvedRentals,
      activeRentals,
      completedRentals,
      rentalsByStatus,
      ownerRentals,
    ] = await Promise.all([
      equipmentCollection.countDocuments({ ownerId: req.user.id }),
      equipmentCollection.countDocuments({
        ownerId: req.user.id,
        status: "pending",
      }),
      equipmentCollection.countDocuments({
        ownerId: req.user.id,
        status: "approved",
      }),
      equipmentCollection.countDocuments({
        ownerId: req.user.id,
        availability: "unavailable",
      }),
      rentalCollection.countDocuments({ ownerId: req.user.id }),
      rentalCollection.countDocuments({
        ownerId: req.user.id,
        status: "pending",
      }),
      rentalCollection.countDocuments({
        ownerId: req.user.id,
        status: "approved",
      }),
      rentalCollection.countDocuments({
        ownerId: req.user.id,
        status: "active",
      }),
      rentalCollection.countDocuments({
        ownerId: req.user.id,
        status: "completed",
      }),
      rentalCollection
        .aggregate([
          { $match: { ownerId: req.user.id } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
        .toArray(),
      rentalCollection
        .find({ ownerId: req.user.id })
        .project({ _id: 1 })
        .toArray(),
    ]);

    const rentalIdSet = new Set(
      ownerRentals.map((rental) => rental._id.toString())
    );

    const [paidPayments, monthRentals] = await Promise.all([
      paymentCollection
        .find({ paymentStatus: "paid" })
        .project({
          rentalId: 1,
          amount: 1,
          createdAt: 1,
        })
        .toArray(),
      rentalCollection.countDocuments({
        ownerId: req.user.id,
        createdAt: { $gte: monthStart },
      }),
    ]);

    // Only count payments tied to this owner's rentals, deduplicated
    // by payment id so a session recorded twice never counts twice.
    const seen = new Set();
    let totalEarnings = 0;
    let monthlyEarnings = 0;

    for (const payment of paidPayments) {
      if (!rentalIdSet.has(String(payment.rentalId))) continue;

      const key = payment._id.toString();

      if (seen.has(key)) continue;
      seen.add(key);

      const amount = Number(payment.amount);

      if (!Number.isFinite(amount)) continue;

      totalEarnings += amount;

      if (
        payment.createdAt &&
        new Date(payment.createdAt) >= monthStart
      ) {
        monthlyEarnings += amount;
      }
    }

    const rentalsByStatusMap = {};

    for (const entry of rentalsByStatus) {
      rentalsByStatusMap[entry._id || "unknown"] = entry.count;
    }

    return res.status(200).json({
      success: true,
      message: "Owner analytics fetched successfully",
      data: {
        equipment: {
          total: totalEquipment,
          pending: pendingEquipment,
          approved: approvedEquipment,
          unavailable: unavailableEquipment,
        },
        rentals: {
          total: totalRentals,
          pending: pendingRentals,
          approved: approvedRentals,
          active: activeRentals,
          completed: completedRentals,
          thisMonth: monthRentals,
          byStatus: rentalsByStatusMap,
        },
        earnings: {
          total: Number(totalEarnings.toFixed(2)),
          monthly: Number(monthlyEarnings.toFixed(2)),
          paidTransactions: seen.size,
        },
      },
    });
  } catch (error) {
    console.error("Owner analytics error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch owner analytics",
    });
  }
});

export default router;
