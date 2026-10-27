const cartService = require("../services/cartService");

/*
=========================================
ADD TO CART
=========================================
*/

exports.addToCart = async (req, res) => {

    try {

        const cart = await cartService.addItemToCart({

            userId: req.user.id,

            warehouseId: req.body.warehouseId,

            productId: req.body.productId,

            productName: req.body.productName,

            category: req.body.category,

            image: req.body.image,

            sku: req.body.sku,

            description: req.body.description,

            unit: req.body.unit,

            price: req.body.price,

            quantity: req.body.quantity

        });

        return res.status(200).json({

            success: true,

            cart

        });

    } catch (error) {

        return res.status(400).json({

            success: false,

            message: error.message

        });

    }

};


/*
=========================================
GET CART
=========================================
*/

exports.getCart = async (req, res) => {

    try {

        const cart = await cartService.getCart(

            req.user.id,

            req.params.warehouseId

        );

        return res.status(200).json({

            success: true,

            cart

        });

    } catch (error) {

        return res.status(400).json({

            success: false,

            message: error.message

        });

    }

};


/*
=========================================
UPDATE QUANTITY
=========================================
*/

exports.updateCart = async (req, res) => {

    try {

        const cart = await cartService.updateQuantity(

            req.user.id,

            req.body.warehouseId,

            req.body.productId,

            req.body.quantity

        );

        return res.status(200).json({

            success: true,

            cart

        });

    } catch (error) {

        return res.status(400).json({

            success: false,

            message: error.message

        });

    }

};


/*
=========================================
REMOVE PRODUCT
=========================================
*/

exports.removeCartItem = async (req, res) => {

    try {

        const cart = await cartService.removeItem(

            req.user.id,

            req.body.warehouseId,

            req.params.productId

        );

        return res.status(200).json({

            success: true,

            cart

        });

    } catch (error) {

        return res.status(400).json({

            success: false,

            message: error.message

        });

    }

};


/*
=========================================
CLEAR CART
=========================================
*/

exports.clearCart = async (req, res) => {

    try {

        await cartService.clearCart(

            req.user.id,

            req.params.warehouseId

        );

        return res.status(200).json({

            success: true,

            message: "Cart cleared successfully"

        });

    } catch (error) {

        return res.status(400).json({

            success: false,

            message: error.message

        });

    }

};


/*
=========================================
PLACE ORDER
=========================================
*/

exports.placeOrder = async (req, res) => {

    try {

        const order = await cartService.placeOrder(

            req.user.id,

            req.body

        );

        return res.status(200).json({

            success: true,

            message: "Order placed successfully",

            order

        });

    } catch (error) {

        const retryWithNewId =
            error.code === "CHECKOUT_EXPIRED" || error.code === "CHECKOUT_RETRY_NEW_ID";
        return res.status(retryWithNewId ? 409 : 400).json({

            success: false,

            ...(retryWithNewId ? { code: error.code } : {}),

            message: error.message

        });

    }

};