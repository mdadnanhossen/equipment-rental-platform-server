
import express from "express";

import { getCollection } from "../config/database.js";
import { verifyAuth } from "../middleware/auth.middleware.js";


const router = express.Router();

router.use(verifyAuth);

function serializeProfile(user) {
  return {
    _id: user._id?.toString(),
    id: user._id?.toString(),
    name: user.name || "",
    email: user.email || "",
    image: user.image || "",
    phone: typeof user.phone === "string" ? user.phone : "",
    address: typeof user.address === "string" ? user.address : "",
    role: user.role || "customer",
    createdAt: user.createdAt || null,
  };
}


/**
 * POST /api/profile/upload-image
 * Upload authenticated user's profile image to Cloudinary.
 */
router.post("/upload-image", (req, res, next) => {
  upload.single("image")(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.message || "Image upload failed",
      });
    }

    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select an image",
      });
    }

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "rentora/profile-images",
          resource_type: "image",
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      );

      stream.end(req.file.buffer);
    });

    const imageUrl = uploadResult.secure_url;

    const userCollection = getCollection("user");

    const updatedUser = await userCollection.findOneAndUpdate(
      { email: req.user.email },
      {
        $set: {
          image: imageUrl,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile image uploaded successfully",
      data: serializeProfile(updatedUser),
    });
  } catch (error) {
    console.error("Profile image upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to upload profile image",
    });
  }
});


/**
 * GET /api/profile
 * Any authenticated user: fetch own profile.
 */
router.get("/", async (req, res) => {
  try {
    const userCollection = getCollection("user");

    const user = await userCollection.findOne({
      email: req.user.email,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      data: serializeProfile(user),
    });
  } catch (error) {
    console.error("Profile fetch error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
    });
  }
});

/**
 * PATCH /api/profile
 * Any authenticated user: update own profile details.
 * Role and email are intentionally NOT editable here.
 */
router.patch("/", async (req, res) => {
  try {
    const { name, phone, address, image } = req.body;

    const updates = {};

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Name cannot be empty",
        });
      }

      updates.name = name.trim().slice(0, 100);
    }

    if (phone !== undefined) {
      if (typeof phone !== "string") {
        return res.status(400).json({
          success: false,
          message: "Phone must be text",
        });
      }

      const sanitizedPhone = phone.trim();

      if (
        sanitizedPhone &&
        !/^[+\d][\d\s\-()]{5,19}$/.test(sanitizedPhone)
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid phone number",
        });
      }

      updates.phone = sanitizedPhone.slice(0, 30);
    }

    if (address !== undefined) {
      if (typeof address !== "string") {
        return res.status(400).json({
          success: false,
          message: "Address must be text",
        });
      }

      updates.address = address.trim().slice(0, 300);
    }

    if (image !== undefined) {
      if (typeof image !== "string") {
        return res.status(400).json({
          success: false,
          message: "Image must be a URL string",
        });
      }

      updates.image = image.trim().slice(0, 500);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid profile fields provided",
      });
    }

    updates.updatedAt = new Date();

    const userCollection = getCollection("user");

    const result = await userCollection.findOneAndUpdate(
      { email: req.user.email },
      { $set: updates },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: serializeProfile(result),
    });
  } catch (error) {
    console.error("Profile update error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
    });
  }
});

export default router;
