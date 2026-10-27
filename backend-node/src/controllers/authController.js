const User = require("../models/User");
const ShopkeeperDetails = require("../models/ShopkeeperDetails");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { validateObjectId } = require("../middleware/validationMiddleware");


// REGISTER

const register = async (req, res) => {
  try {

    const {
      name,
      email,
      password,
      phone
    } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and phone are required"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters"
      });
    }

    const existingUser =
      await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists"
      });
    }

    const hashedPassword =
      await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone,
      role: "user"
    });

    await ShopkeeperDetails.create({
      userId: user._id,
      fullName: name,
      phone,
      shopCategory: "",
      address: {
        fullName: name,
        phone,
        addressLine1: "",
        addressLine2: "",
        landmark: "",
        city: "",
        state: "",
        country: "",
        pincode: "",
        addressType: "Home",
      },
    });

    res.status(201).json({
      success: true,
      message:
        "Registration Successful",
      user
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
};


// LOGIN

const login = async (req, res) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(503).json({
      success: false,
      message: "Authentication is not configured"
    });
  }

  try {

    const {
      email,
      password
    } = req.body;

    const user =
      await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const isMatch =
      await bcrypt.compare(
        password,
        user.password
      );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid Password"
      });
    }

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role
      },
      jwtSecret,
      {
        expiresIn: "1d"
      }
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
};


// GET ALL USERS

const getAllUsers = async (
  req,
  res
) => {
  try {

    const users =
      await User.find()
        .select("-password")
        .sort({
          createdAt: -1
        });

    res.status(200).json({
      success: true,
      users
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
};


// GET SINGLE USER

const getUserById = async (
  req,
  res
) => {
  try {

    const user =
      await User.findById(
        req.params.id
      ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      user
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
};


// UPDATE USER

const updateUser = async (
  req,
  res
) => {
  try {

    const {
      name,
      email,
      phone,
      role
    } = req.body;

    const user =
      await User.findById(
        req.params.id
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    user.name =
      name || user.name;

    user.email =
      email || user.email;

    user.phone =
      phone || user.phone;

    if (role) {
      user.role = role;
    }

    await user.save();

    if (user) {
      await ShopkeeperDetails.findOneAndUpdate(
        { userId: user._id },
        {
          $set: {
            fullName: user.name || undefined,
            phone: user.phone || undefined,
          },
        },
        { upsert: true }
      );
    }

    res.status(200).json({
      success: true,
      message:
        "User Updated Successfully",
      user
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
};


// DELETE USER

const deleteUser = async (
  req,
  res
) => {
  try {
    const objectIdErrors = validateObjectId(req.params.id, "id");

    if (objectIdErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: objectIdErrors
      });
    }

    const user =
      await User.findById(
        req.params.id
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    await User.findByIdAndDelete(
      req.params.id
    );

    await ShopkeeperDetails.deleteOne({ userId: req.params.id });

    res.status(200).json({
      success: true,
      message:
        "User Deleted Successfully"
    });

  } catch (error) {

    res.status(500).json({
      success: false,
      message: error.message,
      errors: []
    });

  }
};


module.exports = {
  register,
  login,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser
};