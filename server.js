// server.js
// server.js
import express from 'express';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());

// ES module __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(express.static(__dirname));

/***********************
 * CONSTANTS
 ***********************/
const foodDescriptions = {
  "sushi roll": "Sushi rolls include rice, seaweed, and fillings like avocado, cucumber, or fish.",
  "sashimi": "Sashimi is thinly sliced raw fish, served without rice.",
  "nigiri": "Nigiri is raw fish pressed on rice.",
  "miso soup": "Miso soup contains fermented soybean paste, tofu, and seaweed.",
  "tempura": "Tempura is deep-fried shrimp or veggies.",
  "mochi": "A rice cake dessert, usually filled with ice cream.",
  "edamame": "Steamed soybeans, vegan and gluten-free.",
  "green tea": "Traditional Japanese green tea."
};
const PRICES = { "sushi roll":4.5,"sashimi":6,"nigiri":2.5,"miso soup":3,"tempura":7,"mochi":3.5,"edamame":3,"green tea":2 };
const CURRENCY = "€";
const KNOWN_ITEMS = Object.keys(foodDescriptions);
const KNOWN_INGREDIENTS = ["wasabi","ginger","pickled ginger","gari","soy sauce","soy","mayo","spicy mayo","chili","sugar"];

/***********************
 * MEMORY PER SESSION
 ***********************/
const carts = new Map();
const details = new Map();

/***********************
 * UTILS
 ***********************/
function getSessionId(req) {
  const full = String(req.body.session || "");
  const parts = full.split("/sessions/");
  return parts[1] || "default";
}

function parseQuantity(params) { return Number(params.quantity || params.number || params.amount || 1) || 1; }
function parseFood(params, text) {
  let food = (params.food_item || params.item || "").toLowerCase().trim();
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

function linePrice(item, qty) { return +(PRICES[item] * qty).toFixed(2); }
function orderTotal(sessionId) { return +(carts.get(sessionId)?.reduce((s,r)=>s+linePrice(r.item,r.qty),0)||0).toFixed(2); }
function fmt(amount) { return `${CURRENCY}${amount.toFixed(2)}`; }
function cartSummary(sessionId) {
  const cart = carts.get(sessionId) || [];
  if (!cart.length) return "Your cart is empty.";
  return cart.map(r=>`${r.qty} x ${r.item}`+(r.mods.length?` (${r.mods.map(m=>`${m.action} ${m.ingredient}`).join(", ")})`:"")+` — ${fmt(linePrice(r.item,r.qty))}`).join(", ");
}
function clearSession(sessionId) { carts.delete(sessionId); details.delete(sessionId); }

/***********************
 * KITCHEN SIMULATOR
 ***********************/
let kitchenOrders = [];
function sendToKitchen(order) {
  console.log("🍳 Sending to kitchen:", order);
  kitchenOrders.push({ order, status: "preparing" });
  setTimeout(() => {
    kitchenOrders = kitchenOrders.map(o => o.order.orderNumber===order.orderNumber ? {...o, status:"ready"} : o);
    console.log("✅ Order ready:", order.orderNumber);
  }, 5000);
}

/***********************
 * DIALOGFLOW TOKEN HELPER
 ***********************/
async function getAccessToken() {
  const jsonPath = path.join(os.tmpdir(), 'temp-service-account.json');
  fs.writeFileSync(jsonPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  const auth = new GoogleAuth({ keyFile: jsonPath, scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

/***********************
 * DIALOGFLOW QUERY ROUTE
 ***********************/
app.post("/dialogflow-query", async (req, res) => {
  try {
    const token = await getAccessToken();
    const response = await fetch(
      'https://dialogflow.googleapis.com/v2/projects/panda-hinl/agent/sessions/web-user-session:detectIntent',
      {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
        body: JSON.stringify({ queryInput: { text: { text: req.body.text||"Hello", languageCode:"en" } } })
      }
    );
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Dialogflow request failed' });
  }
});

/***********************
 * MAIN WEBHOOK
 ***********************/
// Keep your /webhook routes for ordering as before

/***********************
 * HEALTH CHECK
 ***********************/
app.get("/", (req,res)=>res.send("Panda Sushi webhook running ✔️"));

/***********************
 * START SERVER
 ***********************/
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`🚀 Webhook live on port ${PORT}`));
