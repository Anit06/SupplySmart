const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    return res.status(503).json({
      success: false,
      message: "Authentication is not configured",
    });
  }

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    const [scheme, token, ...extra] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token || extra.length > 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid Token",
      });
    }

    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid Token",
    });
  }
};

module.exports = authMiddleware;
