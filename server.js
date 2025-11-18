const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static(__dirname));
const { getAccessToken } = require("./token");


/******************************
 *  CONSTANTS & KNOWLEDGE BASE
 ******************************/
const foodDescriptions = {
  "sushi roll": "Sushi rolls include rice, seaweed, and fillings like avocado, cucumber, or fish.",
  "sashimi": "Sashimi is thinly sliced raw fish, served without rice.",
  "nigiri": "Nigiri is raw fish pressed on rice.",
  "miso soup": "Miso soup contains fermented soybean paste, tofu, and seaweed.",
  "tempura": "Tempura is deep-fried shrimp or veggies.",
  "mochi": "Mochi is a rice cake dessert, usually filled with ice cream.",
  "edamame": "Steamed soybeans, vegan and gluten-free.",
  "green tea": "Traditional Japanese green tea."
};

const KNOWN_ITEMS = Object.keys(foodDescriptions);
const KNOWN_INGREDIENTS = [
  "wasabi","ginger","pickled ginger","gari","soy sauce","soy","mayo","spicy mayo","chili","sugar"
];

const PRICES = {
  "sushi roll": 4.50,
  "sashimi": 6.00,
  "nigiri": 2.50,
  "miso soup": 3.00,
  "tempura": 7.00,
  "mochi": 3.50,
  "edamame": 3.00,
  "green tea": 2.00
};
const CURRENCY = "€";

/******************************
 *  MEMORY PER SESSION
 ******************************/
const carts = new Map();      // sessionId → [{item, qty, mods}]
const details = new Map();    // sessionId → {name, table, pickupTime}

/******************************
 *  UTILS
 ******************************/
function getSessionId(req) {
  const full = String(req.body.session || "");
  const parts = full.split("/sessions/");
  return parts[1] || "default";
}

function parseQuantity(params) {
  const q = params.quantity || params.number || params.amount || 1;
  return Number(q) || 1;
}

function parseFood(params, text) {
  let food = params.food_item || params.item || "";
  food = String(food).toLowerCase().trim();

  if (!food) {
    const hit = KNOWN_ITEMS.find(i => text.includes(i));
    if (hit) return hit;
  }
  return food;
}

function addToCart(sessionId, item, qty) {
  const cart = carts.get(sessionId) || [];
  const row = cart.find(r => r.item === item);
  if (row) row.qty += qty;
  else cart.push({ item, qty, mods: [] });
  carts.set(sessionId, cart);
}

function removeFromCart(sessionId, item, qty) {
  const cart = carts.get(sessionId) || [];
  const idx = cart.findIndex(r => r.item === item);
  if (idx === -1) return 0;

  if (!qty || qty >= cart[idx].qty) {
    const removed = cart[idx].qty;
    cart.splice(idx, 1);
    carts.set(sessionId, cart);
    return removed;
  }
  cart[idx].qty -= qty;
  carts.set(sessionId, cart);
  return qty;
}

function applyModifier(sessionId, item, action, ingredient) {
  const cart = carts.get(sessionId) || [];
  if (!cart.length) return { ok: false, reason: "empty" };

  let row = cart.find(r => r.item === item) || cart[cart.length - 1];
  if (!row) return { ok: false, reason: "not_found" };

  row.mods.push({ action, ingredient });
  carts.set(sessionId, cart);
  return { ok: true, item: row.item };
}

function linePrice(item, qty) {
  return +(PRICES[item] * qty).toFixed(2);
}

function orderTotal(sessionId) {
  const cart = carts.get(sessionId) || [];
  return +cart.reduce((s, r) => s + linePrice(r.item, r.qty), 0).toFixed(2);
}

function fmt(amount) {
  return `${CURRENCY}${amount.toFixed(2)}`;
}

function cartSummary(sessionId) {
  const cart = carts.get(sessionId) || [];
  if (!cart.length) return "Your cart is empty.";

  return cart
    .map(r => `${r.qty} x ${r.item}` +
      (r.mods.length ? ` (${r.mods.map(m => `${m.action} ${m.ingredient}`).join(", ")})` : "") +
      ` — ${fmt(linePrice(r.item, r.qty))}`)
    .join(", ");
}

function clearSession(sessionId) {
  carts.delete(sessionId);
  details.delete(sessionId);
}

/******************************
 *  KITCHEN SIMULATOR
 ******************************/
let kitchenOrders = [];

function sendToKitchen(order) {
  console.log("🍳 Sending to kitchen:", order);
  kitchenOrders.push({ order, status: "preparing" });

  setTimeout(() => {
    kitchenOrders = kitchenOrders.map(o =>
      o.order.orderNumber === order.orderNumber
        ? { ...o, status: "ready" }
        : o
    );
    console.log("✅ Order ready:", order.orderNumber);
  }, 5000);
}

/******************************
 *  MAIN WEBHOOK
 ******************************/
app.post("/webhook", (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const intent = req.body.queryResult.intent.displayName;
    const text = req.body.queryResult.queryText.toLowerCase();
    const params = req.body.queryResult.parameters || {};

    console.log("\n🎯 Intent:", intent, "| Text:", text, "| Session:", sessionId);

    let response = "Okay.";

    /********** SMALL TALK & BASIC RULES **********/
    if (intent === "Default Welcome Intent") {
      response = "Hello! Welcome to Panda Sushi 🍣 What would you like today?";
    }
    else if (text.includes("menu")) {
      response = "Here is our menu: 🍣 Sushi rolls, 🍱 Nigiri, 🍜 Ramen, 🥟 Dumplings, 🍵 Matcha tea.";
    }
    else if (text === "hi" || text === "hello") {
      response = "Hi there 👋 How can I help you today?";
    }

    /********** FOOD INFORMATION **********/
    else if (intent === "Ask.About.Food") {
      const food = parseFood(params, text);
      response = foodDescriptions[food]
        ? `Here's what I know about ${food}: ${foodDescriptions[food]}`
        : `I don't have information about that item.`;
    }

    /********** ADD FOOD **********/
    else if (intent === "Order.Food") {
      const food = parseFood(params, text);
      if (!foodDescriptions[food]) {
        response = "I couldn't recognize that item. Could you repeat the food name?";
      } else {
        const qty = parseQuantity(params);
        addToCart(sessionId, food, qty);
        response = `Added ${qty} x ${food}. Current order: ${cartSummary(sessionId)}.`;
      }
    }

    /********** REMOVE FOOD **********/
    else if (intent === "Order.Remove") {
      const food = parseFood(params, text);
      const qty = parseQuantity(params);

      const removed = removeFromCart(sessionId, food, qty);
      response = removed
        ? `Removed ${removed} x ${food}. Current order: ${cartSummary(sessionId)}.`
        : `I couldn’t find ${food} in your order.`;
    }

    /********** MODIFY ORDER **********/
    else if (intent === "order.modify") {
      let action = params.modifier_action || (text.includes("no") ? "no" : "");
      let ingredient = params.ingredient || KNOWN_INGREDIENTS.find(i => text.includes(i));
      const food = parseFood(params, text);

      if (!action || !ingredient) {
        response = "Please specify the modifier, e.g. 'no wasabi' or 'extra ginger'.";
      } else {
        const out = applyModifier(sessionId, food, action, ingredient);
        response = out.ok
          ? `Done — ${action} ${ingredient} on ${out.item}.`
          : "I couldn't apply that change.";
      }
    }

    /********** ORDER SUMMARY **********/
    else if (intent === "Order.Summary") {
      response = `Here’s your order: ${cartSummary(sessionId)}. Total: ${fmt(orderTotal(sessionId))}.`;
    }

    /********** CLEAR ORDER **********/
    else if (intent === "Order.Clear") {
      clearSession(sessionId);
      response = "Your order has been cleared.";
    }

    /********** NAME **********/
    else if (intent === "Order.SetName") {
      const name = params.guest_name || text.split(" ").pop();
      const d = details.get(sessionId) || {};
      d.name = name;
      details.set(sessionId, d);
      response = `Great! I added the name ${name}.`;
    }

    /********** TABLE **********/
    else if (intent === "Order.SetTable") {
      const table = params.table || text.match(/\d+/)?.[0];
      const d = details.get(sessionId) || {};
      d.table = table;
      details.set(sessionId, d);
      response = `Got it — table ${table}.`;
    }

    /********** PICKUP TIME **********/
    else if (intent === "Order.SetPickupTime") {
      const t = params.time || params["date-time"] || text;
      const d = details.get(sessionId) || {};
      d.pickupTime = t;
      details.set(sessionId, d);
      response = `Pickup time set to ${t}.`;
    }

    /********** CONFIRM **********/
    else if (intent === "Order.Confirm") {
      const summary = cartSummary(sessionId);
      const total = orderTotal(sessionId);

      const orderNumber = Math.floor(Math.random() * 900 + 100);
      response = `Your order #${orderNumber} is confirmed! 🎉 ${summary}. Total: ${fmt(total)}.`;

      sendToKitchen({ orderNumber, items: carts.get(sessionId), total });

      clearSession(sessionId);
    }

    return res.json({
      fulfillmentMessages: [{ text: { text: [response] } }]
    });

  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.json({
      fulfillmentMessages: [{ text: { text: ["Server error."] } }]
    });
  }
});

/******************************
 *  HEALTH CHECK ROUTES
 ******************************/
app.get("/", (req, res) => res.send("Panda Sushi webhook running ✔️"));

/******************************
 *  START SERVER
 ******************************/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook live on port ${PORT}`));

