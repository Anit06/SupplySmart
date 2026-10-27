const normalizeRole = (role) => String(role || "").trim().toLowerCase();

const expandRoleAliases = (roles) => {
    const expanded = new Set();
    for (const role of roles) {
        const normalized = normalizeRole(role);
        if (!normalized) continue;
        expanded.add(normalized);
        if (normalized === "admin") {
            expanded.add("administrative_user");
        }
        if (normalized === "administrative_user") {
            expanded.add("admin");
        }
    }
    return expanded;
};

module.exports = (...roles) => {
    const permittedRoles = expandRoleAliases(roles);

    return (req, res, next) => {
        const userRole = normalizeRole(req.user?.role);

        if (!permittedRoles.has(userRole)) {
            return res.status(403).json({
                success: false,
                message: "Access Denied"
            });
        }

        next();
    };
};