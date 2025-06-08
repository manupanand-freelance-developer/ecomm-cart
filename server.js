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
app.get('/metrics', async (req, res) => {
try {
        res.header('Content-Type', 'text/plain');
        res.send(register.metrics());
    } catch (err) {
        req.log.error('Metrics Error:', err);
        res.status(500).send('Metrics fetch failed');
    }
});

// -----------------------
// Redis Connection
// -----------------------



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

// Health check
app.get('/health',async (req, res) => {
    try {
        res.json({ app: 'OK', redis: redisConnected });
    } catch (err) {
        req.log.error('Health check failed:', err);
        res.status(500).send('Health check failed');
    }
});
///------------------------------------------------------

// app.get('/debug-redis/:key', async (req, res) => {
//   try {
//     const redisKey = req.params.key;
//     const value = await redisClient.get(redisKey);
//     if (value === null) {
//       return res.status(404).send(`Key '${redisKey}' not found`);
//     }
//     res.set('Content-Type', 'application/json');
//     res.send(value);
//   } catch (err) {
//     console.error('Redis error:', err);
//     res.status(500).send('Redis error');
//   }
// });




//----------delete test route

// get cart with id
app.get('/cart/:id', async (req, res) => {
   try { 
     const key = `cart:${req.params.id}`;
    console.log('Requested cart ID:', req.params.id);
    console.log('Redis key to fetch:', key);
      const data = await redisClient.get(`cart:${req.params.id}`);
        
        if (!data) {
            return res.status(404).send('Cart not found');
        }
            console.log('Redis returned:', data);
        res.set('Content-Type', 'application/json');
        res.send(data);
}
    catch (error){
         req.log.error('Error fetching cart:', error);
        res.status(500).send('Internal Server Error');
    }
});

// delete cart with id
app.delete('/cart/:id', async (req, res) => {
   try { 
        const result = await redisClient.del(`cart:${req.params.id}`);

        if (result === 1) {
            res.send('OK');
        } else {
            res.status(404).send('Cart not found');
        }
    }catch (error){
        req.log.error('Error deleting cart:', error);
        res.status(500).send('Internal Server Error');
    }
});

// rename cart i.e. at login
app.get('/rename/:from/:to', async  (req, res) => {
 try {   
       const data = await redisClient.get(`cart:${req.params.from}`);

        if (!data) {
            return res.status(404).send('cart not found');
        }

        const cart = JSON.parse(data);

        await saveCart(req.params.to, cart); 
        res.json(cart);
    }catch (error){
         req.log.error('Error in rename:', error );
        res.status(500).send('Internal Server Error');
    }
});

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
        let cart = cartData ? JSON.parse(cartData) : {
            total: 0,
            tax: 0,
            items: []
        };

        req.log.info('got cart', cart);

        const item = {
            qty,
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

// update quantity - remove item when qty == 0
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

        const cartData = await redisClient.get(`cart:${req.params.id}`);
        if (!cartData) {
            return res.status(404).send('cart not found');
        }

        const cart = JSON.parse(cartData);
        const index = cart.items.findIndex(item => item.sku === req.params.sku);

        if (index === -1) {
            return res.status(404).send('item not in cart');
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
        req.log.error('Error in /update route:', err);
        res.status(500).send('Internal Server Error');
    }
});


// add shipping
app.post('/shipping/:id', async (req, res) => {
    try {
        const shipping = req.body;

        if (!shipping || shipping.distance === undefined || shipping.cost === undefined || shipping.location === undefined) {
            req.log.warn('shipping data missing', shipping);
            return res.status(400).send('shipping data missing');
        }

        const cartData = await redisClient.get(`cart:${req.params.id}`);

        if (!cartData) {
            req.log.info('no cart for', req.params.id);
            return res.status(404).send('cart not found');
        }

        const cart = JSON.parse(cartData);
        const shippingItem = {
            qty: 1,
            sku: 'SHIP',
            name: `shipping to ${shipping.location}`,
            price: shipping.cost,
            subtotal: shipping.cost
        };

        const index = cart.items.findIndex(item => item.sku === 'SHIP');

        if (index === -1) {
            cart.items.push(shippingItem);
        } else {
            cart.items[index] = shippingItem;
        }

        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        await saveCart(req.params.id, cart);
        res.json(cart);

    } catch (err) {
        req.log.error('Error in /shipping route:', err);
        res.status(500).send('Internal Server Error');
    }
});

///------------------------------------------
function mergeList(list, product, qty) {
    var inlist = false;
    // loop through looking for sku
    var idx;
    var len = list.length;
    for(idx = 0; idx < len; idx++) {
        if(list[idx].sku == product.sku) {
            inlist = true;
            break;
        }
    }

    if(inlist) {
        list[idx].qty += qty;
        list[idx].subtotal = list[idx].price * list[idx].qty;
    } else {
        list.push(product);
    }

    return list;
}

function calcTotal(list) {
    var total = 0;
    for(var idx = 0, len = list.length; idx < len; idx++) {
        total += list[idx].subtotal;
    }

    return total;
}

function calcTax(total) {
    // tax @ 20%
    return (total - (total / 1.2));
}

async function getProduct(sku) {
    return new Promise((resolve, reject) => {
        request(`http://${catalogueHost}:${cataloguePort}/product/${sku}`, (err, res, body) => {
            if (err) {
                return reject(err);
            }
            if (res.statusCode !== 200) {
                return resolve(null);
            }

            try {
                resolve(JSON.parse(body));
            } catch (parseError) {
                reject(new Error(`Invalid JSON from catalogue service: ${parseError.message}`));
            }
        });
    });
}


async function saveCart(id, cart) {
    try {
        logger.info('saving cart', cart);
        await  redisClient.set(`cart:${id}`, JSON.stringify(cart));
    } catch (err) {
        logger.error(`Failed to save cart for ID ${id}:`, err);
        throw err; // propagate to let the caller handle it
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

