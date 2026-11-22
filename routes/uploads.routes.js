
import express from "express";
import cloudinary from "../config/cloudinary.js";
import upload from "../middleware/upload.middleware.js";

const router = express.Router();

/**
 * POST /api/uploads/profile-image
 * Public upload endpoint for signup profile images.
 */
router.post("/profile-image", (req, res, next) => {
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

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "rentora/profile-images",
          resource_type: "image",
        },
        (error, uploadedImage) => {
          if (error) reject(error);
          else resolve(uploadedImage);
        }
      );

      stream.end(req.file.buffer);
    });

    return res.status(200).json({
      success: true,
      message: "Profile image uploaded successfully",
      data: {
        image: result.secure_url,
      },
    });
  } catch (error) {
    console.error("Signup profile image upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to upload profile image",
    });
  }
});

export default router;
