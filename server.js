const express = require('express');
const app = express();
app.use(express.json());

// Health checks
app.get('/', (req, res) => res.send('Panada webhook OK'));
app.get('/webhook', (req, res) => res.send('Panada webhook endpoint is up (use POST for Dialogflow)'));

// Sushi knowledge base (define once)
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

// In-memory carts (per session)
const carts = new Map(); // sessionId -> [{ item, qty }, ...]

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

function removeFromCart(sessionId, item, qty = null) {
  const cart = carts.get(sessionId) || [];
  const idx = cart.findIndex(r => r.item === item);
  if (idx === -1) return { removed: 0, cart };
  if (qty === null || qty >= cart[idx].qty) {
    const removedQty = cart[idx].qty;
    cart.splice(idx, 1);
    carts.set(sessionId, cart);
    return { removed: removedQty, cart };
  } else {
    cart[idx].qty -= qty;
    carts.set(sessionId, cart);
    return { removed: qty, cart };
  }
}

function cartSummary(sessionId) {
  const cart = carts.get(sessionId) || [];
  if (cart.length === 0) return 'Your cart is empty.';
  return cart.map(r => `${r.qty} x ${r.item}`).join(', ');
}

// ✅ Single webhook handler
app.post('/webhook', (req, res) => {
  try {
    // Safe reads
    const body = (req && req.body) ? req.body : {};
    const sessionId = getSessionId(req);

    const qr = body.queryResult || {};
    const intent = (qr.intent && qr.intent.displayName) ? qr.intent.displayName : '';
    const originalText = ((qr.queryText || '') + '').toLowerCase();
    const params = qr.parameters || {};

    // Quantity: accept several param names, default to 1
    const quantityRaw = (params.quantity ?? params.number ?? params.amount ?? params.qty ?? null);
    const quantity =
      (typeof quantityRaw === 'number' && isFinite(quantityRaw))
        ? quantityRaw
        : Number(quantityRaw) || 1;

    // Food: normalize to string
    let food = ((params.food_item ?? params.item ?? '') + '').toLowerCase().trim();

    // Safety net: correct mis-tags using the original user text
    const knownItems = Object.keys(foodDescriptions);
    const directHit = knownItems.find(k => originalText.includes(k));
    if (directHit) food = directHit;
    if (!food) {
      const single = knownItems.find(k => {
        const last = k.split(' ').slice(-1)[0]; // e.g., "mochi"
        return originalText.includes(last);
      });
      if (single) food = single;
    }

    let responseText = 'Okay.';

    if (intent === 'Ask.About.Food') {
      const answer = foodDescriptions[food];
      responseText = answer
        ? `Here's what I know about ${food}: ${answer}`
        : `I'm sorry, I don't have information about ${food || 'that item'}.`;
    }

    else if (intent === 'Order.Food') {
      if (!foodDescriptions[food]) {
        responseText = `I couldn't recognize the item. Could you say the sushi item again?`;
      } else {
        addToCart(sessionId, food, quantity);
        responseText = `Added ${quantity} x ${food} to your order. Current order: ${cartSummary(sessionId)}. Would you like anything else?`;
      }
    }

    else if (intent === 'Order.Remove') {
      const remQtyRaw = params.quantity ?? params.number ?? params.amount ?? params.qty ?? null;
      const remQty =
        (typeof remQtyRaw === 'number' && isFinite(remQtyRaw))
          ? remQtyRaw
          : (Number(remQtyRaw) || null);

      if (!food) {
        responseText = `Which item should I remove?`;
      } else {
        const { removed } = removeFromCart(sessionId, food, remQty);
        if (removed === 0) {
          responseText = `I couldn’t find ${food} in your order. Current order: ${cartSummary(sessionId)}.`;
        } else {
          responseText = `Removed ${remQty ?? removed} x ${food}. Current order: ${cartSummary(sessionId)}.`;
        }
      }
    }

    else if (intent === 'Order.Confirm') {
      const summary = cartSummary(sessionId);
      if (summary === 'Your cart is empty.') {
        responseText = `I don't see anything in your order yet. What would you like to have?`;
      } else {
        responseText = `Awesome! 🐼 Your order is confirmed: ${summary}. Enjoy! 🥢`;
        carts.delete(sessionId); // clear after confirmation
      }
    }

    else {
      responseText = `Got it. How can I help with your sushi order?`;
    }

    return res.json({ fulfillmentMessages: [{ text: { text: [responseText] } }] });
  } catch (e) {
    console.error('Webhook error:', e);
    return res.json({
      fulfillmentMessages: [{ text: { text: ["(Webhook) Unexpected error. Check server logs."] } }]
    });
  }
});

// Start server (must be last)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Panada webhook is live on port ${PORT}`));
