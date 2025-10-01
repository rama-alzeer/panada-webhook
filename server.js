const express = require('express');
const app = express();
app.use(express.json());

// Simple health check
app.get('/', (req, res) => res.send('Panada webhook OK'));

// Optional: sanity-check the webhook path in a browser
app.get('/webhook', (req, res) => res.send('Panada webhook endpoint is up (use POST for Dialogflow)'));

// Sushi knowledge base (define once, top-level)
const foodDescriptions = {
  "sushi roll": "Sushi rolls include rice, seaweed, and fillings like avocado, cucumber, or fish. Vegetarian options available.",
  "sashimi": "Sashimi is thinly sliced raw fish, served without rice.",
  "nigiri": "Nigiri is raw fish pressed on rice. It's not cooked.",
  "miso soup": "Miso soup contains fermented soybean paste, tofu, and seaweed. It's vegan-friendly.",
  "tempura": "Tempura is deep-fried shrimp or veggies. It's crispy and may be spicy.",
  "mochi": "Mochi is a rice cake dessert, often filled with ice cream. It may contain gluten and dairy.",
  "edamame": "Edamame are steamed soybeans. They're vegan, gluten-free, and healthy.",
  "green tea": "Green tea is a traditional Japanese drink. It's vegan and caffeine-rich."
};

const carts = new Map(); // sessionId -> [{item, qty}, ...]

function getSessionId(req) {
  const full = (req.body && req.body.session) ? req.body.session : '';
  const parts = full.split('/sessions/');
  return parts[1] || full || 'default';
}

function addToCart(sessionId, item, qty = 1) {
  const cart = carts.get(sessionId) || [];
  const existing = cart.find(r => r.item === item);
  if (existing) existing.qty += qty;
  else cart.push({ item, qty });
  carts.set(sessionId, cart);
}

function cartSummary(sessionId) {
  const cart = carts.get(sessionId) || [];
  if (cart.length === 0) return 'Your cart is empty.';
  return cart.map(r => `${r.qty} x ${r.item}`).join(', ');
}


const carts = new Map(); // sessionId -> [{item, qty}, ...]

function getSessionId(req) {
  const full = req.body?.session || '';
  const parts = full.split('/sessions/');
  return parts[1] || full;
}

function addToCart(sessionId, item, qty = 1) {
  const cart = carts.get(sessionId) || [];
  const existing = cart.find(r => r.item === item);
  if (existing) existing.qty += qty;
  else cart.push({ item, qty });
  carts.set(sessionId, cart);
}

function cartSummary(sessionId) {
  const cart = carts.get(sessionId) || [];
  if (cart.length === 0) return 'Your cart is empty.';
  return cart.map(r => `${r.qty} x ${r.item}`).join(', ');
}

app.post('/webhook', (req, res) => {
  try {
    const qr = (req.body && req.body.queryResult) ? req.body.queryResult : {};
    const params = qr.parameters || {};
    const food = (params.food_item || '').toString().toLowerCase().trim();

    if (!food) {
      return res.json({
        fulfillmentMessages: [{ text: { text: ["Which item are you asking about?"] } }]
      });
    }

    const answer = foodDescriptions[food];
    const text = answer
      ? `Here's what I know about ${food}: ${answer}`
      : `I'm sorry, I don't have information about ${food}.`;

    return res.json({ fulfillmentMessages: [{ text: { text: [text] } }] });
  } catch (e) {
    console.error('Desc webhook error:', e);
    return res.json({ fulfillmentMessages: [{ text: { text: ["Error in desc handler"] } }] });
  }
});
