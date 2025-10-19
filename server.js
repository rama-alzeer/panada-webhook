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

// -------- Prices --------
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
function linePrice(itemName, qty) {
  const p = PRICES[itemName] ?? 0;
  return +(p * qty).toFixed(2);
}
function orderTotal(sessionId) {
  const cart = carts.get(sessionId) || [];
  const sum = cart.reduce((acc, r) => acc + linePrice(r.item, r.qty), 0);
  return +sum.toFixed(2);
}
function fmtMoney(amount) {
  return `${CURRENCY}${amount.toFixed(2)}`;
}
function cartSummary(sessionId, withLineTotals = true) {
  const cart = carts.get(sessionId) || [];
  if (!cart.length) return 'Your cart is empty.';
  const line = r => {
    const modsTxt = (r.mods && r.mods.length)
      ? ` (${r.mods.map(m => `${m.action} ${m.ingredient}`).join(', ')})`
      : '';
    const base = `${r.qty} x ${r.item}${modsTxt}`;
    if (!withLineTotals) return base;
    return `${base} — ${fmtMoney(linePrice(r.item, r.qty))}`;
  };
  return cart.map(line).join(', ');
}
// --- Guest details memory per session ---
const details = new Map(); // sessionId -> { name?: string, table?: string|number, pickupTime?: string }

function setName(sessionId, name) {
  const d = details.get(sessionId) || {};
  d.name = name;
  details.set(sessionId, d);
}
function setTable(sessionId, table) {
  const d = details.get(sessionId) || {};
  d.table = table;
  details.set(sessionId, d);
}
function setPickupTime(sessionId, t) {
  const d = details.get(sessionId) || {};
  d.pickupTime = t;
  details.set(sessionId, d);
}
function getDetails(sessionId) {
  return details.get(sessionId) || {};
}
function clearSession(sessionId) {
  carts.delete(sessionId);
  details.delete(sessionId);
}

// -------- Helper: robust param parsing --------
function parseQuantity(params) {
  const raw = params.quantity ?? params.number ?? params.amount ?? params.qty ?? null;
  if (typeof raw === 'number' && isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw))) return Number(raw);
  return 1;
}
function parseFood(params, originalText) {
  let rawFood = params.food_item ?? params.item ?? '';
  // Handle array case
  if (Array.isArray(rawFood)) rawFood = rawFood[0];
  let food = String(rawFood).toLowerCase().trim();

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
//--- Webhook --------
app.post('/webhook', (req, res) => {
  try {
    const sessionId = getSessionId(req);
    const body = req.body || {};
    const qr = body.queryResult || {};
    const intent = (qr.intent && qr.intent.displayName) ? qr.intent.displayName : '';
    const originalText = ((qr.queryText || '') + '').toLowerCase();
    const params = qr.parameters || {};

    console.log('PARAMS:', JSON.stringify(params));

    

    // Debug log per request
    console.log('Session:', sessionId, '| Intent:', intent, '| Text:', originalText, '| Cart:', JSON.stringify(carts.get(sessionId) || []));

    // Detect remove phrasing even if DF misroutes
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
    else if (intent === 'order.modify') {
      let action = (params.modifier_action || '').toString().toLowerCase().trim(); // 'no' | 'extra' | 'less'
      let ingredient = (params.ingredient || '').toString().toLowerCase().trim();
      let item = (params.food_item || '').toString().toLowerCase().trim();

      if (!action) {
        if (/\b(no|without|hold|skip|remove)\b/.test(originalText)) action = 'no';
        else if (/\b(extra|add more|double)\b/.test(originalText)) action = 'extra';
        else if (/\b(less|light|easy on|not too much)\b/.test(originalText)) action = 'less';
      }
      if (!ingredient) {
        const hit = KNOWN_INGREDIENTS
          .filter(i => originalText.includes(i))
          .sort((a, b) => b.length - a.length)[0];
        if (hit) ingredient = hit;
      }
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
      if (!food) {
        responseText = `Which item should I remove?`;
      } else {
        const { removed } = removeFromCart(sessionId, food, qty);
        console.log('Cart AFTER remove:', JSON.stringify(carts.get(sessionId) || []));
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
        console.log('Cart AFTER add:', JSON.stringify(carts.get(sessionId) || []));
        const total = orderTotal(sessionId);
        responseText = `Added ${qty} x ${food} to your order. Current order: ${cartSummary(sessionId)}. Current total: ${fmtMoney(total)}. Would you like anything else?`;
      }
    }

    // --- Order.Summary ---
    else if (intent === 'Order.Summary') {
      const summary = cartSummary(sessionId);
      if (summary === 'Your cart is empty.') {
        responseText = `Your cart is empty. Want to add something?`;
      } else {
        const total = orderTotal(sessionId);
        responseText = `Here’s your current order: ${summary}. Total: ${fmtMoney(total)}.`;
      }
    }

    // --- Order.Clear ---
    else if (intent === 'Order.Clear') {
      carts.delete(sessionId);
      responseText = `All set — I cleared your order. Want to start a new one?`;
    }
    // --- Order.SetName ---
else if (intent === 'Order.SetName') {
  let name = (params.guest_name || params.name || '').toString().trim();
  // fallback: try to pull first word after "i'm" / "my name is"
  if (!name) {
    const m = originalText.match(/\b(i'?m|my name is)\s+([a-z]+)\b/i);
    if (m) name = m[2];
  }
  if (!name) {
    responseText = `What name should I put on the order?`;
  } else {
    setName(sessionId, name.charAt(0).toUpperCase() + name.slice(1));
    const d = getDetails(sessionId);
    responseText = `Thanks, ${d.name}! ${cartSummary(sessionId) === 'Your cart is empty.' ? 'Want to add something?' : 'Anything else before we confirm?'}`
  }
}

// --- Order.SetTable ---
else if (intent === 'Order.SetTable') {
  let table = (params.table !== undefined ? params.table : params.number);
  if (table === undefined || table === null || table === '') {
    // try to extract from text (e.g., "table 5")
    const m = originalText.match(/\btable\s+(\d+)\b/);
    if (m) table = m[1];
  }
  if (table === undefined || table === null || table === '') {
    responseText = `Which table number are you at?`;
  } else {
    setTable(sessionId, String(table));
    const d = getDetails(sessionId);
    responseText = `Got it — table ${d.table}. ${cartSummary(sessionId) === 'Your cart is empty.' ? 'Ready to order?' : 'Anything else before we confirm?'}`
  }
}

// --- Order.SetPickupTime ---
else if (intent === 'Order.SetPickupTime') {
  // accept various sys.* param names
  const t = (params.pickup_time || params.time || params['date-time'] || '').toString().trim();
  let when = t;
  if (!when) {
    // crude fallback: "in 20 minutes", "at 6 pm"
    const m = originalText.match(/\b(in\s+\d+\s*(min|mins|minutes|hour|hours))|(at\s+\d+(:\d+)?\s*(am|pm)?)\b/);
    if (m) when = m[0];
  }
  if (!when) {
    responseText = `When should we have it ready?`;
  } else {
    setPickupTime(sessionId, when);
    const d = getDetails(sessionId);
    responseText = `Pickup time set for ${d.pickupTime}. ${cartSummary(sessionId) === 'Your cart is empty.' ? 'What would you like to order?' : 'Anything else before we confirm?'}`
  }
}


    // --- Order.Confirm ---
else if (intent === 'Order.Confirm') {
  const summary = cartSummary(sessionId);
  if (summary === 'Your cart is empty.') {
    responseText = `I don't see anything in your order yet. What would you like to have?`;
  } else {
    const d = getDetails(sessionId);
    // Require either table (dine-in) OR name (pickup). Adjust to your flow.
    if (!d.table && !d.name) {
      responseText = `Before I confirm: are you dining in or picking up? You can say “table 5” or “I’m Alex for pickup.”`;
    } else {
      const total = orderTotal(sessionId);
      const header = d.table ? `Table ${d.table}` : `Pickup for ${d.name}`;
      responseText = `Awesome! 🐼 ${header} — ${summary}. Total: ${fmtMoney(total)}. Enjoy! 🥢`;
      sendToKitchen(currentOrder)
      clearSession(sessionId);

    }
  }
}

    
  // Simple kitchen simulation
let kitchenOrders = []; // store orders temporarily

function sendToKitchen(order) {
  console.log("🍳 Sending to kitchen:", order);

  // Add to kitchen queue
  kitchenOrders.push({ order, status: "preparing" });

  // Simulate kitchen preparation
  setTimeout(() => {
    // Mark as ready
    kitchenOrders = kitchenOrders.map(o => 
      o.order === order ? { ...o, status: "ready" } : o
    );
    console.log("✅ Order ready:", order);
  }, 5000); // 5 seconds for demo
}


    // --- Fallback ---
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
