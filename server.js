const express = require('express');
const app = express();
app.use(express.json());

// Simple health check
app.get('/', (req, res) => res.send('Panada webhook OK'));

// Sushi knowledge base
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

app.post('/webhook', (req, res) => {
  try {
    const queryResult = req.body?.queryResult || {};
    const food = (queryResult.parameters?.food_item || '').toLowerCase().trim();

    const answer = foodDescriptions[food];
    const responseText = answer
      ? `Here's what I know about ${food}: ${answer}`
      : food
      ? `I'm sorry, I don't have information about ${food}.`
      : `Could you tell me which item you’re asking about?`;

    return res.json({
      fulfillmentMessages: [{ text: { text: [responseText] } }]
    });
  } catch (e) {
    return res.json({
      fulfillmentMessages: [{ text: { text: ["Oops, something went wrong. Please try again."] } }]
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Panada webhook is live on port ${PORT}`));
