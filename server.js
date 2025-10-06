const express = require('express');
const app = express();
app.use(express.json());

// Health checks
app.get('/', (_req, res) => res.send('Panada webhook OK'));
app.get('/webhook', (_req, res) => res.send('Panada webhook endpoint is up (use POST for Dialogflow)'));

// -------- Menu knowledge base --------
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
const KNOWN_ITEMS = Object.keys(foodDescriptions);

const KNOWN_INGREDIENTS = [
  'wasabi',
  'ginger', 'pickled ginger', 'gari',
  'soy sauce', 'soy', 'soya sauce',
  'mayo', 'mayonnaise', 'spicy mayo',
  'spice', 'chili', 'chilli', 'hot',
  'sugar', 'ice'
];


// -------- In-memory carts (per Dialogflow session) --------
const carts = new Map(); // sessionId -> [{ item, qty, mods: [{action, ingredient}] }]

function getSessionId(req) {
  const full = (req.body && req.body.session) ? String(req.body.session) : '';
  const parts = full.split('/sessions/');
  return parts[1] || full || 'default';
}
function addToCart(sessionId, item, qty = 1) {
  const cart = carts.get(sessionId) || [];
  const row = cart.find(r => r.item === item);
  if (row) row.qty += qty;
  else cart.push({ item, qty, mods: [] });
  carts.set(sessionId, cart);
}
function removeFromCart(sessionId, item, qty = null) {
  const cart = carts.get(sessionId) || [];
  const idx = cart.findIndex(r => r.item === item);
  if (idx === -1) return { removed: 0 };
  if (qty === null || qty >= cart[idx].qty) {
    const removedQty = cart[idx].qty;
    cart.splice(idx, 1);
    carts.set(sessionId, cart);
    return { removed: removedQty };
  } else {
    cart[idx].qty -= qty;
    carts.set(sessionId, cart);
    return { removed: qty };
  }
}
function applyModifier(sessionId, itemNameOrNull, action, ingredient) {
  const cart = carts.get(sessionId) || [];
  if (!cart.length) return { ok: false, reason: 'empty' };
  let row = null;
  if (itemNameOrNull) {
    row = cart.find(r => r.item === itemNameOrNull);
    if (!row) return { ok: false, reason: 'not_found' };
  } else {
    row = cart[cart.length - 1]; // last added
  }
  row.mods = row.mods || [];
  row.mods.push({ action, ingredient });
  carts.set(sessionId, cart);
  return { ok: true, item: row.item };
}
function cartSummary(sessionId) {
  const cart = carts.get(sessionId) || [];
  if (!cart.length) return 'Your cart is empty.';
  const line = r => {
    const modsTxt = (r.mods && r.mods.length)
      ? ` (${r.mods.map(m => `${m.action} ${m.ingredient}`).join(', ')})`
      : '';
    return `${r.qty} x ${r.item}${modsTxt}`;
  };
  return cart.map(line).join(', ');
}

// -------- Helper: robust param parsing --------
function parseQuantity(params) {
  const raw = params.quantity ?? params.number ?? params.amount ?? params.qty ?? null;
  if (typeof raw === 'number' && isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw))) return Number(raw);
  return 1;
}
function parseFood(params, originalText) {
  let food = ((params.food_item ?? params.item ?? '') + '').toLowerCase().trim();
  if (!food) {
    const direct = KNOWN_ITEMS.find(k => originalText.includes(k));
    if (direct) food = direct;
    if (!food) {
      const single = KNOWN_ITEMS.find(k => originalText.includes(k.split(' ').slice(-1)[0]));
      if (single) food = single;
    }
  }
  return food;
}

// -------- Webhook --------
app.post('/webhook', (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const body = req.body || {};
    const qr = body.queryResult || {};
    const intent = (qr.intent && qr.intent.displayName) ? qr.intent.displayName : '';
    const originalText = ((qr.queryText || '') + '').toLowerCase();
    const params = qr.parameters || {};

    // Safety net: detect remove phrasing even if DF misroutes
    const removeRegex = /\b(remove|delete|take\s*(off|out|away)|cancel|no more|minus|drop|take away)\b/;
    const isRemovePhrase = removeRegex.test(originalText);

    let responseText = 'Okay.';

    // --- Ask.About.Food ---
    if (intent === 'Ask.About.Food') {
      const food = parseFood(params, originalText);
      const ans = foodDescriptions[food];
      responseText = ans
        ? `Here's what I know about ${food}: ${ans}`
        : `I'm sorry, I don't have information about ${food || 'that item'}.`;
    }

    // --- Order.Modify ---
    else if (intent === 'Order.Modify') {
  // Extract params if present
  let action = (params.modifier_action || '').toString().toLowerCase().trim(); // 'no' | 'extra' | 'less'
  let ingredient = (params.ingredient || '').toString().toLowerCase().trim();
  let item = (params.food_item || '').toString().toLowerCase().trim();

  // --- Auto-detect action if missing ---
  if (!action) {
    if (/\b(no|without|hold|skip|remove)\b/.test(originalText)) action = 'no';
    else if (/\b(extra|add more|double)\b/.test(originalText)) action = 'extra';
    else if (/\b(less|light|easy on|not too much)\b/.test(originalText)) action = 'less';
  }

  // --- Auto-detect ingredient if missing ---
  if (!ingredient) {
    const hit = KNOWN_INGREDIENTS
      .filter(i => originalText.includes(i))
      .sort((a, b) => b.length - a.length)[0]; // choose longest match (e.g., "soy sauce" over "soy")
    if (hit) ingredient = hit;
  }

  // If no item specified, try detect from text; else apply to last-added item
  if (!item) {
    const direct = KNOWN_ITEMS.find(k => originalText.includes(k));
    if (direct) item = direct;
  }

  if (!action || !ingredient) {
    responseText = `Got it. Please specify the change, like "no wasabi" or "extra ginger".`;
  } else {
    const out = applyModifier(sessionId, item || null, action, ingredient);
    if (!out.ok && out.reason === 'empty') {
      responseText = `Your cart is empty. Add something first, then say a modifier like "no wasabi".`;
    } else if (!out.ok && out.reason === 'not_found') {
      responseText = `I couldn't find ${item} in your order. Current order: ${cartSummary(sessionId)}.`;
    } else {
      responseText = `Done — ${action} ${ingredient}${out.item ? ` on ${out.item}` : ''}. Current order: ${cartSummary(sessionId)}.`;
    }
  }
}


    // --- Order.Remove (or misrouted remove phrase) ---
    else if (intent === 'Order.Remove' || isRemovePhrase) {
      const food = parseFood(params, originalText);
      const qtyRaw = params.quantity ?? params.number ?? params.amount ?? params.qty ?? null;
      const qty = (typeof qtyRaw === 'number' && isFinite(qtyRaw)) ? qtyRaw : (Number(qtyRaw) || null);
      if (!food) responseText = `Which item should I remove?`;
      else {
        const { removed } = removeFromCart(sessionId, food, qty);
        responseText = removed === 0
          ? `I couldn’t find ${food} in your order. Current order: ${cartSummary(sessionId)}.`
          : `Removed ${qty ?? removed} x ${food}. Current order: ${cartSummary(sessionId)}.`;
      }
    }

    // --- Order.Food ---
    else if (intent === 'Order.Food') {
      const food = parseFood(params, originalText);
      if (!foodDescriptions[food]) {
        responseText = `I couldn't recognize the item. Could you say the sushi item again?`;
      } else {
        const qty = parseQuantity(params);
        addToCart(sessionId, food, qty);
        responseText = `Added ${qty} x ${food} to your order. Current order: ${cartSummary(sessionId)}. Would you like anything else?`;
      }
    }

    // --- Order.Summary ---
    else if (intent === 'Order.Summary') {
      const summary = cartSummary(sessionId);
      responseText = summary === 'Your cart is empty.'
        ? `Your cart is empty. Want to add something?`
        : `Here’s your current order: ${summary}.`;
    }

    // --- Order.Clear ---
    else if (intent === 'Order.Clear') {
      carts.delete(sessionId);
      responseText = `All set — I cleared your order. Want to start a new one?`;
    }

    // --- Order.Confirm ---
    else if (intent === 'Order.Confirm') {
      const summary = cartSummary(sessionId);
      if (summary === 'Your cart is empty.') {
        responseText = `I don't see anything in your order yet. What would you like to have?`;
      } else {
        responseText = `Awesome! 🐼 Your order is confirmed: ${summary}. Enjoy! 🥢`;
        carts.delete(sessionId);
      }
    }

    // --- Fallback (unknown webhook intent) ---
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Panada webhook is live on port ${PORT}`));
