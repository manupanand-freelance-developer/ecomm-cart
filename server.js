// newrelic log
require('newrelic');
// Core imports
const redis = require('redis');
const request = require('request');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');
require('dotenv').config();

// Prometheus
const promClient = require('prom-client');
const Registry = promClient.Registry;
const register = new Registry();
const counter = new promClient.Counter({
    name: 'items_added',
    help: 'running count of items added to cart',
    registers: [register]
});

let redisConnected = false;
const redisHost = process.env.REDIS_HOST ||  'redis://localhost:6379';
const catalogueHost = process.env.CATALOGUE_HOST || 'catalogue';
const port = process.env.CART_SERVER_PORT || '8080';
var cataloguePort = process.env.CATALOGUE_PORT || '8080';


// Logger setup
const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});
const expLogger = expPino({ logger });

const app = express();
app.use(expLogger);

app.use((req, res, next) => {
   try {
        res.set('Timing-Allow-Origin', '*');
        res.set('Access-Control-Allow-Origin', '*');
        next();
    } catch (err) {
        req.log.error('Middleware setup error:', err);
        res.status(500).send('Internal server error');
    }
});

// Body parser
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// -----------------------
// Prometheus /metrics endpoint
// -----------------------
app.get('/metrics', (req, res) => {
try {
        res.header('Content-Type', 'text/plain');
        res.send(register.metrics());
    } catch (err) {
        req.log.error('Metrics Error:', err);
        res.status(500).send('Metrics fetch failed');
    }
});

// Health check
app.get('/health', (req, res) => {
    try {
        res.json({ app: 'OK', redis: redisConnected });
    } catch (err) {
        req.log.error('Health check failed:', err);
        res.status(500).send('Health check failed');
    }
});
///------------------------------------------------------
// get cart with id
// app.get('/cart/:id', (req, res) => {
//     redisClient.get(req.params.id, (err, data) => {
//         if(err) {
//             req.log.error('ERROR', err);
//             res.status(500).send(err);
//         } else {
//             if(data == null) {
//                 res.status(404).send('cart not found');
//             } else {
//                 res.set('Content-Type', 'application/json');
//                 res.send(data);
//             }
//         }
//     });
// });
app.get('/cart/:id', (req, res) => {
    redisClient.get(`cart:${req.params.id}`, (err, data) => {
        if(err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if(data == null) {
                res.status(404).send('cart not found');
            } else {
                res.set('Content-Type', 'application/json');
                res.send(data);
            }
        }
    });
});

// delete cart with id
// app.delete('/cart/:id', (req, res) => {
//     redisClient.del(req.params.id, (err, data) => {
//         if(err) {
//             req.log.error('ERROR', err);
//             res.status(500).send(err);
//         } else {
//             if(data == 1) {
//                 res.send('OK');
//             } else {
//                 res.status(404).send('cart not found');
//             }
//         }
//     });
// });
app.delete('/cart/:id', (req, res) => {
    redisClient.del(`cart:${req.params.id}`, (err, data) => {
        if(err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if(data == 1) {
                res.send('OK');
            } else {
                res.status(404).send('cart not found');
            }
        }
    });
});

// rename cart i.e. at login
// app.get('/rename/:from/:to', (req, res) => {
//     redisClient.get(req.params.from, (err, data) => {
//         if(err) {
//             req.log.error('ERROR', err);
//             res.status(500).send(err);
//         } else {
//             if(data == null) {
//                 res.status(404).send('cart not found');
//             } else {
//                 var cart = JSON.parse(data);
//                 saveCart(req.params.to, cart).then((data) => {
//                     res.json(cart);
//                 }).catch((err) => {
//                     req.log.error(err);
//                     res.status(500).send(err);
//                 });
//             }
//         }
//     });
// });
app.get('/rename/:from/:to', (req, res) => {
    redisClient.get(`cart:${req.params.from}`, (err, data) => {
        if(err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if(data == null) {
                res.status(404).send('cart not found');
            } else {
                var cart = JSON.parse(data);
                saveCart(req.params.to, cart).then((data) => {
                    res.json(cart);
                }).catch((err) => {
                    req.log.error(err);
                    res.status(500).send(err);
                });
            }
        }
    });
});
// update/create cart
// app.get('/add/:id/:sku/:qty', (req, res) => {
//     // check quantity
//     var qty = parseInt(req.params.qty);
//     if(isNaN(qty)) {
//         req.log.warn('quantity not a number');
//         res.status(400).send('quantity must be a number');
//         return;
//     } else if(qty < 1) {
//         req.log.warn('quantity less than one');
//         res.status(400).send('quantity has to be greater than zero');
//         return;
//     }

//     // look up product details
//     getProduct(req.params.sku).then((product) => {
//         req.log.info('got product', product);
//         if(!product) {
//             res.status(404).send('product not found');
//             return;
//         }
//         // is the product in stock?
//         if(product.instock == 0) {
//             res.status(404).send('out of stock');
//             return;
//         }
//         // does the cart already exist?
//         redisClient.get(`cart:${req.params.id}`, (err, data) => {
//             if(err) {
//                 req.log.error('ERROR', err);
//                 res.status(500).send(err);
//             } else {
//                 var cart;
//                 if(data == null) {
//                     // create new cart
//                     cart = {
//                         total: 0,
//                         tax: 0,
//                         items: []
//                     };
//                 } else {
//                     cart = JSON.parse(data);
//                 }
//                 req.log.info('got cart', cart);
//                 // add sku to cart
//                 var item = {
//                     qty: qty,
//                     sku: req.params.sku,
//                     name: product.name,
//                     price: product.price,
//                     subtotal: qty * product.price
//                 };
//                 var list = mergeList(cart.items, item, qty);
//                 cart.items = list;
//                 cart.total = calcTotal(cart.items);
//                 // work out tax
//                 cart.tax = calcTax(cart.total);

//                 // save the new cart
//                 saveCart(req.params.id, cart).then((data) => {
//                     counter.inc(qty);
//                     res.json(cart);
//                 }).catch((err) => {
//                     req.log.error(err);
//                     res.status(500).send(err);
//                 });
//             }
//         });
//     }).catch((err) => {
//         req.log.error(err);
//         res.status(500).send(err);
//     });
// });


// update/create cart
app.get('/add/:id/:sku/:qty', async (req, res) => {
    try {
        const qty = parseInt(req.params.qty);
        if (isNaN(qty)) {
            req.log.warn('quantity not a number');
            return res.status(400).send('quantity must be a number');
        }
        if (qty < 1) {
            req.log.warn('quantity less than one');
            return res.status(400).send('quantity has to be greater than zero');
        }

        const product = await getProduct(req.params.sku);
        req.log.info('got product', product);

        if (!product) {
            return res.status(404).send('product not found');
        }

        if (product.instock === 0) {
            return res.status(404).send('out of stock');
        }

        let cartData = await redisClient.get(`cart:${req.params.id}`);
        let cart = cartData ? JSON.parse(cartData) : { total: 0, tax: 0, items: [] };

        req.log.info('got cart', cart);

        const item = {
            qty: qty,
            sku: req.params.sku,
            name: product.name,
            price: product.price,
            subtotal: qty * product.price
        };

        cart.items = mergeList(cart.items, item, qty);
        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        await saveCart(req.params.id, cart);
        counter.inc(qty);
        res.json(cart);

    } catch (err) {
        req.log.error('Error in /add route:', err);
        res.status(500).send('Internal Server Error');
    }
});


// // update quantity - remove item when qty == 0
// app.get('/update/:id/:sku/:qty', (req, res) => {
//     // check quantity
//     var qty = parseInt(req.params.qty);
//     if(isNaN(qty)) {
//         req.log.warn('quanity not a number');
//         res.status(400).send('quantity must be a number');
//         return;
//     } else if(qty < 0) {
//         req.log.warn('quantity less than zero');
//         res.status(400).send('negative quantity not allowed');
//         return;
//     }

//     // get the cart
//     redisClient.get(`cart:${req.params.id}`, (err, data) => {
//         if(err) {
//             req.log.error('ERROR', err);
//             res.status(500).send(err);
//         } else {
//             if(data == null) {
//                 res.status(404).send('cart not found');
//             } else {
//                 var cart = JSON.parse(data);
//                 var idx;
//                 var len = cart.items.length;
//                 for(idx = 0; idx < len; idx++) {
//                     if(cart.items[idx].sku == req.params.sku) {
//                         break;
//                     }
//                 }
//                 if(idx == len) {
//                     // not in list
//                     res.status(404).send('not in cart');
//                 } else {
//                     if(qty == 0) {
//                         cart.items.splice(idx, 1);
//                     } else {
//                         cart.items[idx].qty = qty;
//                         cart.items[idx].subtotal = cart.items[idx].price * qty;
//                     }
//                     cart.total = calcTotal(cart.items);
//                     // work out tax
//                     cart.tax = calcTax(cart.total);
//                     saveCart(req.params.id, cart).then((data) => {
//                         res.json(cart);
//                     }).catch((err) => {
//                         req.log.error(err);
//                         res.status(500).send(err);
//                     });
//                 }
//             }
//         }
//     });
// });
app.get('/update/:id/:sku/:qty', async (req, res) => {
    try {
        const qty = parseInt(req.params.qty);

        if (isNaN(qty)) {
            req.log.warn('quantity not a number');
            return res.status(400).send('quantity must be a number');
        }

        if (qty < 0) {
            req.log.warn('quantity less than zero');
            return res.status(400).send('negative quantity not allowed');
        }

        const data = await redisClient.get(`cart:${req.params.id}`);

        if (data === null) {
            return res.status(404).send('cart not found');
        }

        const cart = JSON.parse(data);
        const index = cart.items.findIndex(item => item.sku === req.params.sku);

        if (index === -1) {
            return res.status(404).send('not in cart');
        }

        if (qty === 0) {
            cart.items.splice(index, 1);
        } else {
            cart.items[index].qty = qty;
            cart.items[index].subtotal = cart.items[index].price * qty;
        }

        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        await saveCart(req.params.id, cart);

        res.json(cart);
    } catch (err) {
        req.log.error('Error updating item quantity:', err);
        res.status(500).send('Internal Server Error');
    }
});


// add shipping
// app.post('/shipping/:id', (req, res) => {
//     var shipping = req.body;
//     if(shipping.distance === undefined || shipping.cost === undefined || shipping.location == undefined) {
//         req.log.warn('shipping data missing', shipping);
//         res.status(400).send('shipping data missing');
//     } else {
//         // get the cart
//         redisClient.get(`cart:${req.params.id}`, (err, data) => {
//             if(err) {
//                 req.log.error('ERROR', err);
//                 res.status(500).send(err);
//             } else {
//                 if(data == null) {
//                     req.log.info('no cart for', req.params.id);
//                     res.status(404).send('cart not found');
//                 } else {
//                     var cart = JSON.parse(data);
//                     var item = {
//                         qty: 1,
//                         sku: 'SHIP',
//                         name: 'shipping to ' + shipping.location,
//                         price: shipping.cost,
//                         subtotal: shipping.cost
//                     };
//                     // check shipping already in the cart
//                     var idx;
//                     var len = cart.items.length;
//                     for(idx = 0; idx < len; idx++) {
//                         if(cart.items[idx].sku == item.sku) {
//                             break;
//                         }
//                     }
//                     if(idx == len) {
//                         // not already in cart
//                         cart.items.push(item);
//                     } else {
//                         cart.items[idx] = item;
//                     }
//                     cart.total = calcTotal(cart.items);
//                     // work out tax
//                     cart.tax = calcTax(cart.total);

//                     // save the updated cart
//                     saveCart(`cart:${req.params.id}`, cart).then((data) => {
//                         res.json(cart);
//                     }).catch((err) => {
//                         req.log.error(err);
//                         res.status(500).send(err);
//                     });
//                 }
//             }
//         });
//     }
// });
app.post('/shipping/:id', async (req, res) => {
    const shipping = req.body;
    
    if (shipping.distance === undefined || shipping.cost === undefined || shipping.location === undefined) {
        req.log.warn('shipping data missing', shipping);
        return res.status(400).send('shipping data missing');
    }

    try {
        const data = await redisClient.get(`cart:${req.params.id}`);

        if (data === null) {
            req.log.info('no cart for', req.params.id);
            return res.status(404).send('cart not found');
        }

        const cart = JSON.parse(data);
        const item = {
            qty: 1,
            sku: 'SHIP',
            name: `shipping to ${shipping.location}`,
            price: shipping.cost,
            subtotal: shipping.cost
        };

        const index = cart.items.findIndex(i => i.sku === 'SHIP');
        if (index === -1) {
            cart.items.push(item);
        } else {
            cart.items[index] = item;
        }

        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        await saveCart(req.params.id, cart);

        res.json(cart);
    } catch (err) {
        req.log.error('Error updating shipping info:', err);
        res.status(500).send('Internal Server Error');
    }
});

//---------------------------------------------------------------
// function mergeList(list, product, qty) {
//  var inlist = false;
//     // loop through looking for sku
//     var idx;
//     var len = list.length;
//     for(idx = 0; idx < len; idx++) {
//         if(list[idx].sku == product.sku) {
//             inlist = true;
//             break;
//         }
//     }

//     if(inlist) {
//         list[idx].qty += qty;
//         list[idx].subtotal = list[idx].price * list[idx].qty;
//     } else {
//         list.push(product);
//     }

//     return list;
// }
function mergeList(list, product, qty) {
    try {
        let index = list.findIndex(item => item.sku === product.sku);
        if (index >= 0) {
            list[index].qty += qty;
            list[index].subtotal = list[index].price * list[index].qty;
        } else {
            list.push(product);
        }
        return list;
    } catch (err) {
        logger.error('mergeList error:', err);
        return list; // return list as-is in case of error
    }
}


function calcTotal(list) {
    var total = 0;
    for(var idx = 0, len = list.length; idx < len; idx++) {
        total += list[idx].subtotal;
    }

    return total;
}

function calcTax(total) {
    return total - total / 1.2;
}

function getProduct(sku) {
    return new Promise((resolve, reject) => {
        request('http://' + catalogueHost + ':' + cataloguePort +'/product/' + sku, (err, res, body) => {
            if(err) {
                reject(err);
            } else if(res.statusCode != 200) {
                resolve(null);
            } else {
                // return object - body is a string
                // TODO - catch parse error
                resolve(JSON.parse(body));
            }
        });
    });
}

// function saveCart(id, cart) {
//     logger.info('saving cart', cart);
//     return new Promise((resolve, reject) => {
//         redisClient.setex(id, 3600, JSON.stringify(cart), (err, data) => { //setx->set
//             if(err) {
//                 reject(err);
//             } else {
//                 resolve(data);
//             }
//         });
//     });
// }
function saveCart(id, cart) {
    try {
        logger.info('saving cart', cart);
        return redisClient.set(`cart:${id}`, JSON.stringify(cart), {
        EX: 3600
    });
    } catch (err) {
        logger.error(`Failed to save cart for ID ${id}:`, err);
        throw err; // propagate to let the caller handle it
    }
}

// -----------------------
// Redis Connection
// -----------------------

// const redisClient = redis.createClient({ url: redisHost });
// async function startServer() {
//     try {

//         await redisConnect();
// // -----------------------
// // Start Server
// // -----------------------

//         app.listen(port, () => {
//             logger.info(`Started on port ${port}`);
//         });
//     } catch (err) {
//         logger.error('Failed to start server:', err);
//         process.exit(1); // Exit if Redis is not connected
//     }
// }
// async function redisConnect() {
//     try {
//         logger.info(`🔄 Attempting Redis connection to ${redisHost}`);
//         await redisClient.connect();
//         logger.info(`✅ Redis connected at ${redisHost}`);
//         redisConnected = true;
//         //startServer(); // Only start the app after Redis is ready
//     } catch (err) {
        
//         logger.error(`❌ Redis connection failed :${err.message}`);

     
//         setTimeout(redisLoop, 2000); // Retry after 2 seconds
//     }
// }
// function redisLoop(){
//     redisConnect().catch((err) => {
//         logger.error(`Unhandled Redis error: ${err.message}`);
//         logger.debug(err.stack);
//         setTimeout(redisLoop, 2000);
//     });
// }
// startServer();



// Create redis client (defer actual connection)
let redisClient = null;

async function createRedisClient() {
    const client = redis.createClient({ url: redisHost });

    client.on('error', (err) => logger.error(`Redis Client Error: ${err.message}`));

    await client.connect(); // Will throw if fails
    return client;
}

async function connectToRedisWithRetry(maxRetries = 5, delayMs = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            logger.info(`🔄 Attempt ${attempt} - Connecting to Redis at ${redisHost}`);
            redisClient = await createRedisClient();
            logger.info(`✅ Redis connected at ${redisHost}`);
            return;
        } catch (err) {
            logger.error(`❌ Redis connection attempt ${attempt} failed: ${err.message}`);
            if (attempt < maxRetries) {
                await new Promise(res => setTimeout(res, delayMs));
            } else {
                throw new Error('Failed to connect to Redis after multiple attempts');
            }
        }
    }
}

function startServer() {
    app.listen(port, () => {
        logger.info(`🚀 Server started on port ${port}`);
    });
}

(async () => {
    try {
        await connectToRedisWithRetry();
        startServer();
    } catch (err) {
        logger.error('❌ Critical startup failure:', err.message);
        process.exit(1);
    }
})();

