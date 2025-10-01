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
    // DEBUG: log the incoming payload (comment out later if too noisy)
    console.log('Incoming DF payload:', JSON.stringify(req.body));

    const sessionId = getSessionId(req);
    const qr = req.body && req.body.queryResult ? req.body.queryResult : {};
    const intent = (qr.intent && qr.intent.displayName) ? qr.intent.displayName : '';
    const originalText = (qr.queryText || '').toLowerCase();

    const knownItems = Object.keys(foodDescriptions);

    const params = qr.parameters || {};
    let food = ((params.food_item || '') + '').toLowerCase().trim();
    const quantityRaw = params.quantity;
    const quantity = (typeof quantityRaw === 'number' && isFinite(quantityRaw))
      ? quantityRaw
      : Number(quantityRaw) || 1;

    // Safety net: correct mis-tags using the original user text
    const directHit = knownItems.find(k => originalText.includes(k));
    if (directHit) food = directHit;
    if (!food) {
      const single = knownItems.find(k => originalText.includes(k.split(' ').slice(-1)[0]));
      if (single) food = single;
    }

    let responseText = 'Okay.';

    if (intent === 'Ask.About.Food') {
      const answer = foodDescriptions[food];
      responseText = answer
        ? `Here's what I know about ${food}: ${answer}`
        : `I'm sorry, I don't have information about ${food}.`;
    } else if (intent === 'Order.Food') {
      if (!foodDescriptions[food]) {
        responseText = `I couldn't recognize the item. Could you say the sushi item again?`;
      } else {
        addToCart(sessionId, food, quantity);
        responseText = `Added ${quantity} x ${food} to your order. Current order: ${cartSummary(sessionId)}. Would you like anything else?`;
      }
    } else if (intent === 'Order.Confirm') {
      const summary = cartSummary(sessionId);
      if (summary === 'Your cart is empty.') {
        responseText = `I don't see anything in your order yet. What would you like to have?`;
      } else {
        responseText = `Awesome! 🐼 Your order is confirmed: ${summary}. Enjoy! 🥢`;
        carts.delete(sessionId); // clear after confirmation
      }
    } else {
      // Unknown intent reached webhook
      responseText = `Got it. How can I help with your sushi order?`;
    }

    return res.json({ fulfillmentMessages: [{ text: { text: [responseText] } }] });
  } catch (e) {
    console.error('Webhook error:', e);
    return res.json({
      fulfillmentMessages: [{ text: { text: ["Oops, something went wrong. Please try again."] } }]
    });
  }
});

