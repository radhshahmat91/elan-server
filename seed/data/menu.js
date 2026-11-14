// The ÉLAN menu: 5 categories, 11 option groups, 26 dishes (one for each piece of generative dish art), and the stock room behind them.
// Dietary tags and allergens are the kitchen's own claims for this fictional restaurant; edit them from the admin menu page.
// Money is whole BDT. Recipes list ingredient keys and the amount used per portion.

export const CATEGORIES = [
  { slug: 'breakfast', name: 'Breakfast & Brunch', description: 'Brunch plates, served all day: slow eggs, warm pastry, something sweet.', sortOrder: 1, art: { motif: 'shakshuka' } },
  { slug: 'starters', name: 'Starters', description: 'Small plates to begin: cold, warm and crisp.', sortOrder: 2, art: { motif: 'burrata' } },
  { slug: 'mains', name: 'Mains', description: 'From the charcoal, the steamer and the slow oven.', sortOrder: 3, art: { motif: 'hilsa' } },
  { slug: 'desserts', name: 'Desserts', description: 'Made each morning, finished at the table.', sortOrder: 4, art: { motif: 'fondant' } },
  { slug: 'drinks', name: 'Drinks', description: 'Coffee, tea and alcohol-free drinks made in house.', sortOrder: 5, art: { motif: 'chai' } },
];

const choice = (key, name, priceDelta = 0, isDefault = false) => ({ key, name, priceDelta, isDefault });

export const ADD_ONS = [
  {
    key: 'cooking-level', name: 'Cooking level', helper: 'Medium rare is how the chef prefers it.', isRequired: true, minSelect: 1, maxSelect: 1,
    choices: [
      choice('rare', 'Rare'),
      choice('medium-rare', 'Medium rare', 0, true),
      choice('medium', 'Medium'),
      choice('medium-well', 'Medium well'),
      choice('well-done', 'Well done'),
    ],
  },
  {
    key: 'spice-level', name: 'Spice level', helper: 'We cook it fresh, so we can go gentler or fiercer.', isRequired: true, minSelect: 1, maxSelect: 1,
    choices: [choice('mild', 'Mild'), choice('medium', 'Medium', 0, true), choice('hot', 'Hot')],
  },
  {
    key: 'sides', name: 'Add a side', helper: 'Up to two.', isRequired: false, minSelect: 0, maxSelect: 2,
    choices: [
      choice('garlic-fries', 'Garlic fries', 180),
      choice('truffle-mash', 'Truffle mash', 240),
      choice('charred-greens', 'Charred greens', 200),
      choice('steamed-rice', 'Steamed rice', 100),
      choice('side-salad', 'Side salad', 160),
    ],
  },
  {
    key: 'sauces', name: 'Sauce', helper: 'Up to two.', isRequired: false, minSelect: 0, maxSelect: 2,
    choices: [
      choice('peppercorn', 'Peppercorn', 90),
      choice('chimichurri', 'Chimichurri', 80),
      choice('mustard-cream', 'Mustard cream', 80),
      choice('chilli-oil', 'Chilli oil', 40),
    ],
  },
  {
    key: 'brunch-extras', name: 'Make it bigger', helper: 'Up to three.', isRequired: false, minSelect: 0, maxSelect: 3,
    choices: [
      choice('extra-egg', 'Extra egg', 60),
      choice('smoked-salmon', 'Smoked salmon', 320),
      choice('avocado', 'Avocado', 180),
      choice('sourdough', 'Sourdough toast', 80),
    ],
  },
  {
    key: 'burger-extras', name: 'Burger extras', helper: 'Up to three.', isRequired: false, minSelect: 0, maxSelect: 3,
    choices: [
      choice('extra-patty', 'Extra patty', 350),
      choice('smoked-cheddar', 'Smoked cheddar', 90),
      choice('fried-egg', 'Fried egg', 60),
      choice('crispy-shallots', 'Crispy shallots', 50),
    ],
  },
  {
    key: 'biryani-extras', name: 'With the biryani', helper: 'Up to two.', isRequired: false, minSelect: 0, maxSelect: 2,
    choices: [choice('borhani', 'Borhani', 90), choice('salad', 'Fresh salad', 60), choice('boiled-egg', 'Boiled egg', 50)],
  },
  {
    key: 'dessert-extras', name: 'On the side', helper: 'Pick one.', isRequired: false, minSelect: 0, maxSelect: 1,
    choices: [choice('vanilla-ice-cream', 'Vanilla ice cream', 90), choice('salted-caramel', 'Salted caramel', 70), choice('fresh-berries', 'Fresh berries', 120)],
  },
  {
    key: 'drink-size', name: 'Size', helper: 'Regular unless you choose large.', isRequired: false, minSelect: 0, maxSelect: 1,
    choices: [choice('large', 'Large', 80)],
  },
];

export const SUPPLIERS = [
  { key: 'karwan', name: 'Karwan Bazar Fresh', contactName: 'Rafiq Ahmed', phone: '+880 1711-000101', email: 'orders@karwan.example', address: 'Karwan Bazar, Dhaka', notes: 'Vegetables and herbs. Delivers by 7 am.' },
  { key: 'meghna', name: 'Meghna Fisheries', contactName: 'Shirin Akter', phone: '+880 1711-000102', email: 'sales@meghna.example', address: 'Fish landing, Chandpur', notes: 'River hilsa and prawns, iced overnight.' },
  { key: 'savar', name: 'Savar Dairy Farms', contactName: 'Mizanur Rahman', phone: '+880 1711-000103', email: 'dairy@savar.example', address: 'Savar, Dhaka', notes: 'Milk, cream, butter, yoghurt and eggs.' },
  { key: 'oldtown', name: 'Old Dhaka Spice House', contactName: 'Haji Karim', phone: '+880 1711-000104', email: 'hello@spicehouse.example', address: 'Chawkbazar, Old Dhaka', notes: 'Spices, rice, tea and dry goods.' },
  { key: 'prime', name: 'Gulshan Prime Meats', contactName: 'Imran Hossain', phone: '+880 1711-000105', email: 'prime@meats.example', address: 'Gulshan 1, Dhaka', notes: 'Aged beef, mutton and lamb.' },
];

// stock is the opening balance; low is the alert level; cost is BDT per unit; expiresInDays is for perishables.
export const INGREDIENTS = [
  { key: 'hilsa', name: 'Hilsa (ilish) steaks', unit: 'kg', stock: 14, low: 5, cost: 1950, supplier: 'meghna', expiresInDays: 3 },
  { key: 'prawns', name: 'Tiger prawns', unit: 'kg', stock: 8, low: 3, cost: 1450, supplier: 'meghna', expiresInDays: 3 },
  { key: 'scallops', name: 'Sea scallops', unit: 'pcs', stock: 20, low: 24, cost: 240, supplier: 'meghna', expiresInDays: 2 },
  { key: 'ribeye', name: 'Grass-fed ribeye', unit: 'kg', stock: 12, low: 5, cost: 2300, supplier: 'prime', expiresInDays: 9 },
  { key: 'beef-mince', name: 'Dry-aged beef mince', unit: 'kg', stock: 10, low: 4, cost: 1100, supplier: 'prime', expiresInDays: 4 },
  { key: 'lamb-shank', name: 'Lamb shanks', unit: 'pcs', stock: 20, low: 8, cost: 900, supplier: 'prime', expiresInDays: 6 },
  { key: 'mutton', name: 'Mutton, kacchi cut', unit: 'kg', stock: 15, low: 6, cost: 1250, supplier: 'prime', expiresInDays: 4 },
  { key: 'basmati', name: 'Aged basmati rice', unit: 'kg', stock: 40, low: 10, cost: 210, supplier: 'oldtown' },
  { key: 'arborio', name: 'Arborio rice', unit: 'kg', stock: 12, low: 3, cost: 420, supplier: 'oldtown' },
  { key: 'mushrooms', name: 'Wild mushrooms', unit: 'kg', stock: 2.2, low: 2.5, cost: 1100, supplier: 'karwan', expiresInDays: 4 },
  { key: 'burrata', name: 'Burrata', unit: 'pcs', stock: 24, low: 10, cost: 380, supplier: 'savar', expiresInDays: 2 },
  { key: 'tomatoes', name: 'Heirloom tomatoes', unit: 'kg', stock: 14, low: 5, cost: 220, supplier: 'karwan', expiresInDays: 5 },
  { key: 'pumpkin', name: 'Pumpkin', unit: 'kg', stock: 16, low: 5, cost: 70, supplier: 'karwan' },
  { key: 'cauliflower', name: 'Cauliflower', unit: 'kg', stock: 8, low: 3, cost: 110, supplier: 'karwan', expiresInDays: 6 },
  { key: 'brioche', name: 'Brioche loaves', unit: 'pcs', stock: 8, low: 3, cost: 320, supplier: 'savar', expiresInDays: 3 },
  { key: 'eggs', name: 'Eggs', unit: 'pcs', stock: 240, low: 90, cost: 18, supplier: 'savar', expiresInDays: 14 },
  { key: 'butter', name: 'Butter', unit: 'kg', stock: 9, low: 3, cost: 980, supplier: 'savar', expiresInDays: 30 },
  { key: 'cream', name: 'Heavy cream', unit: 'l', stock: 12, low: 4, cost: 520, supplier: 'savar', expiresInDays: 6 },
  { key: 'milk', name: 'Whole milk', unit: 'l', stock: 40, low: 12, cost: 95, supplier: 'savar', expiresInDays: 4 },
  { key: 'yoghurt', name: 'Yoghurt', unit: 'kg', stock: 18, low: 6, cost: 190, supplier: 'savar', expiresInDays: 7 },
  { key: 'mascarpone', name: 'Mascarpone', unit: 'kg', stock: 1.2, low: 2, cost: 1700, supplier: 'savar', expiresInDays: 10 },
  { key: 'mustard-seed', name: 'Mustard seed', unit: 'kg', stock: 4, low: 1.5, cost: 420, supplier: 'oldtown' },
  { key: 'chocolate', name: 'Dark chocolate 70%', unit: 'kg', stock: 6, low: 2, cost: 1600, supplier: 'oldtown' },
  { key: 'coffee', name: 'Coffee beans', unit: 'kg', stock: 9, low: 3, cost: 2100, supplier: 'oldtown' },
  { key: 'mango', name: 'Mango pulp', unit: 'kg', stock: 12, low: 4, cost: 320, supplier: 'karwan' },
  { key: 'lemons', name: 'Lemons', unit: 'kg', stock: 10, low: 3, cost: 240, supplier: 'karwan', expiresInDays: 12 },
  { key: 'flour', name: 'Pastry flour', unit: 'kg', stock: 25, low: 8, cost: 75, supplier: 'oldtown' },
  { key: 'chai-masala', name: 'Chai masala', unit: 'kg', stock: 2, low: 0.6, cost: 1300, supplier: 'oldtown' },
  { key: 'tea', name: 'Assam tea leaves', unit: 'kg', stock: 5, low: 1.5, cost: 900, supplier: 'oldtown' },
  { key: 'herbs', name: 'Fresh herbs', unit: 'kg', stock: 3, low: 1, cost: 600, supplier: 'karwan', expiresInDays: 4 },
  { key: 'linguine', name: 'Dried linguine', unit: 'kg', stock: 15, low: 4, cost: 380, supplier: 'oldtown' },
  { key: 'chia', name: 'Chia seeds', unit: 'kg', stock: 4, low: 1, cost: 900, supplier: 'oldtown' },
  { key: 'coconut-milk', name: 'Coconut milk', unit: 'l', stock: 12, low: 4, cost: 280, supplier: 'oldtown' },
  { key: 'elderflower', name: 'Elderflower cordial', unit: 'l', stock: 6, low: 2, cost: 1100, supplier: 'oldtown' },
];

// Helper keeping the dish table below readable.
const r = (ingredient, quantity) => ({ ingredient, quantity });

export const DISHES = [
  // ------------------------------------------------------------------------------------------------ breakfast
  {
    slug: 'brioche-french-toast', category: 'breakfast', motif: 'french-toast', seed: 11,
    name: 'Brioche French Toast', description: 'Thick brioche soaked overnight in vanilla custard, caramelised in butter, with roasted stone fruit, mascarpone and maple.',
    price: 520, tags: ['vegetarian'], allergens: ['gluten', 'dairy', 'egg'], spice: 0, portion: '1 plate', calories: 640, prep: 14,
    ingredients: ['Brioche', 'Vanilla custard', 'Roasted stone fruit', 'Mascarpone', 'Maple syrup'], groups: ['brunch-extras'], featured: true, recipe: [r('brioche', 0.25), r('eggs', 2), r('butter', 0.03), r('milk', 0.1), r('mascarpone', 0.04)],
  },
  {
    slug: 'shakshuka-labneh', category: 'breakfast', motif: 'shakshuka', seed: 23,
    name: 'Shakshuka with Labneh', description: 'Tomatoes cooked down with cumin and chilli, two eggs baked on top, cool labneh and warm flatbread for the sauce.',
    price: 560, tags: ['vegetarian', 'spicy'], allergens: ['gluten', 'dairy', 'egg'], spice: 2, portion: '1 pan', calories: 520, prep: 16,
    ingredients: ['Tomatoes', 'Eggs', 'Cumin', 'Chilli', 'Labneh', 'Flatbread'], groups: ['spice-level', 'brunch-extras'], recipe: [r('tomatoes', 0.2), r('eggs', 2), r('yoghurt', 0.06), r('herbs', 0.01)],
  },
  {
    slug: 'coconut-chia-parfait', category: 'breakfast', motif: 'parfait', seed: 37,
    name: 'Coconut Chia Parfait', description: 'Chia set overnight in coconut milk, layered with ripe mango, toasted coconut and lime. Nothing from an animal.',
    price: 420, tags: ['vegan', 'gluten-free', 'dairy-free'], allergens: [], spice: 0, portion: '1 glass', calories: 360, prep: 6,
    ingredients: ['Chia seeds', 'Coconut milk', 'Mango', 'Toasted coconut', 'Lime'], groups: [], recipe: [r('chia', 0.04), r('coconut-milk', 0.15), r('mango', 0.08)],
  },
  {
    slug: 'almond-croissant', category: 'breakfast', motif: 'croissant', seed: 41,
    name: 'Almond Croissant', description: 'A butter croissant baked twice, filled with almond frangipane and dusted with sugar. Lovely with the cold brew.',
    price: 380, salePrice: 320, tags: ['vegetarian'], allergens: ['gluten', 'dairy', 'egg', 'nuts'], spice: 0, portion: '1 piece', calories: 450, prep: 6,
    ingredients: ['Butter croissant', 'Almond frangipane', 'Sugar'], groups: [], recipe: [r('flour', 0.1), r('butter', 0.06), r('eggs', 1)],
  },
  // ------------------------------------------------------------------------------------------------ starters
  {
    slug: 'burrata-roasted-tomato', category: 'starters', motif: 'burrata', seed: 53,
    name: 'Burrata, Roasted Tomato & Basil', description: 'Creamy burrata over slow-roasted heirloom tomatoes, basil oil and warm sourdough.',
    price: 780, tags: ['vegetarian', 'chef-pick'], allergens: ['dairy', 'gluten'], spice: 0, portion: 'To share', calories: 480, prep: 9,
    ingredients: ['Burrata', 'Heirloom tomatoes', 'Basil', 'Sourdough', 'Olive oil'], groups: [], featured: true, recipe: [r('burrata', 1), r('tomatoes', 0.15), r('herbs', 0.01)],
  },
  {
    slug: 'smoked-pumpkin-soup', category: 'starters', motif: 'soup', seed: 61,
    name: 'Smoked Pumpkin Soup', description: 'Pumpkin roasted over charcoal until sweet, blended with cream and finished with toasted pumpkin seeds.',
    price: 420, tags: ['vegetarian', 'gluten-free'], allergens: ['dairy'], spice: 0, portion: '1 bowl', calories: 280, prep: 8,
    ingredients: ['Pumpkin', 'Cream', 'Butter', 'Pumpkin seeds'], groups: [], recipe: [r('pumpkin', 0.3), r('cream', 0.04), r('butter', 0.01)],
  },
  {
    slug: 'seared-scallops-cauliflower', category: 'starters', motif: 'scallops', seed: 71,
    name: 'Seared Scallops, Cauliflower Purée', description: 'Three sea scallops seared in brown butter on cauliflower purée, with crisp capers and lemon.',
    price: 980, tags: ['gluten-free', 'chef-pick'], allergens: ['shellfish', 'dairy'], spice: 0, portion: '3 pieces', calories: 340, prep: 11,
    ingredients: ['Sea scallops', 'Cauliflower', 'Brown butter', 'Capers', 'Lemon'], groups: [], recipe: [r('scallops', 3), r('cauliflower', 0.12), r('butter', 0.02), r('lemons', 0.02)],
  },
  // ------------------------------------------------------------------------------------------------ mains
  {
    slug: 'wild-mushroom-risotto', category: 'mains', motif: 'risotto', seed: 83,
    name: 'Wild Mushroom Risotto', description: 'Arborio stirred slowly with wild mushrooms, aged parmesan and thyme butter.',
    price: 980, salePrice: 890, tags: ['vegetarian', 'gluten-free'], allergens: ['dairy'], spice: 0, portion: '1 plate', calories: 620, prep: 20,
    ingredients: ['Arborio rice', 'Wild mushrooms', 'Parmesan', 'Thyme butter'], groups: ['sides'], recipe: [r('arborio', 0.09), r('mushrooms', 0.12), r('butter', 0.025), r('cream', 0.03)],
  },
  {
    slug: 'dry-aged-beef-burger', category: 'mains', motif: 'burger', seed: 97,
    name: 'Dry-aged Beef Burger', description: 'Two dry-aged beef patties, smoked cheddar, pickled onion and house sauce in a brioche bun.',
    price: 1050, tags: ['signature'], allergens: ['gluten', 'dairy', 'egg', 'mustard'], spice: 0, portion: '1 burger', calories: 940, prep: 18,
    ingredients: ['Dry-aged beef', 'Smoked cheddar', 'Pickled onion', 'House sauce', 'Brioche bun'], groups: ['cooking-level', 'burger-extras', 'sides'], recipe: [r('beef-mince', 0.24), r('brioche', 0.2), r('butter', 0.01)],
  },
  {
    slug: 'tiger-prawn-linguine', category: 'mains', motif: 'linguine', seed: 101,
    name: 'Tiger Prawn Linguine', description: 'Fresh linguine, tiger prawns, garlic, chilli, lemon and sweet tomato.',
    price: 1280, tags: ['spicy'], allergens: ['gluten', 'shellfish', 'egg'], spice: 2, portion: '1 plate', calories: 710, prep: 17,
    ingredients: ['Linguine', 'Tiger prawns', 'Garlic', 'Chilli', 'Tomato', 'Lemon'], groups: ['spice-level'], recipe: [r('linguine', 0.12), r('prawns', 0.14), r('tomatoes', 0.08), r('lemons', 0.02)],
  },
  {
    slug: 'grass-fed-ribeye', category: 'mains', motif: 'ribeye', seed: 113,
    name: 'Grass-fed Ribeye, 300 g', description: 'Thirty-day aged ribeye grilled over charcoal, rested and finished with bone-marrow butter.',
    price: 2350, tags: ['gluten-free', 'signature'], allergens: ['dairy'], spice: 0, portion: '300 g', calories: 860, prep: 24,
    ingredients: ['Aged ribeye', 'Bone-marrow butter', 'Sea salt'], groups: ['cooking-level', 'sauces', 'sides'], featured: true, recipe: [r('ribeye', 0.3), r('butter', 0.03)],
  },
  {
    slug: 'slow-braised-lamb-shank', category: 'mains', motif: 'lamb', seed: 127,
    name: 'Slow-braised Lamb Shank', description: 'Six hours in its own juices with rosemary and garlic, served over soft polenta.',
    price: 1890, tags: ['gluten-free'], allergens: ['dairy'], spice: 0, portion: '1 shank', calories: 820, prep: 22,
    ingredients: ['Lamb shank', 'Rosemary', 'Garlic', 'Polenta'], groups: ['sauces', 'sides'], recipe: [r('lamb-shank', 1), r('butter', 0.02), r('herbs', 0.01), r('milk', 0.1)],
  },
  {
    slug: 'ilish-bhapa', category: 'mains', motif: 'hilsa', seed: 131,
    name: 'Ilish Bhapa', description: 'River hilsa steamed in banana leaf with ground mustard, green chilli and mustard oil, with steamed rice.',
    price: 1650, tags: ['gluten-free', 'spicy', 'signature', 'chef-pick'], allergens: ['fish', 'mustard'], spice: 2, portion: '1 steak + rice', calories: 780, prep: 21,
    ingredients: ['Hilsa', 'Mustard', 'Green chilli', 'Mustard oil', 'Banana leaf', 'Rice'], groups: ['spice-level', 'sides'], featured: true, recipe: [r('hilsa', 0.28), r('mustard-seed', 0.03), r('basmati', 0.12)],
  },
  {
    slug: 'dhakaiya-kacchi-biryani', category: 'mains', motif: 'biryani', seed: 149,
    name: 'Dhakaiya Kacchi Biryani', description: 'Marinated mutton and aged basmati sealed and cooked together on slow coals, with potato.',
    price: 1450, tags: ['gluten-free', 'spicy', 'signature'], allergens: ['dairy'], spice: 2, portion: '1 plate', calories: 960, prep: 20,
    ingredients: ['Mutton', 'Basmati rice', 'Yoghurt', 'Saffron', 'Fried onion', 'Potato'], groups: ['spice-level', 'biryani-extras'], featured: true, recipe: [r('mutton', 0.25), r('basmati', 0.18), r('yoghurt', 0.05), r('butter', 0.02)],
  },
  {
    slug: 'mushroom-wellington', category: 'mains', motif: 'wellington', seed: 157,
    name: 'Mushroom Wellington', description: 'Roasted mushroom and spinach duxelles in golden pastry, served with onion gravy.',
    price: 1380, tags: ['vegetarian', 'chef-pick', 'new'], allergens: ['gluten', 'dairy', 'egg', 'mustard'], spice: 0, portion: '1 slice', calories: 690, prep: 22,
    ingredients: ['Mushrooms', 'Spinach', 'Puff pastry', 'Onion gravy'], groups: ['sauces', 'sides'], newArrival: true, recipe: [r('mushrooms', 0.2), r('flour', 0.1), r('butter', 0.05), r('eggs', 1)],
  },
  // ------------------------------------------------------------------------------------------------ desserts
  {
    slug: 'dark-chocolate-fondant', category: 'desserts', motif: 'fondant', seed: 163,
    name: 'Dark Chocolate Fondant', description: 'A warm 70% chocolate pudding with a molten centre, served with vanilla cream.',
    price: 520, tags: ['vegetarian'], allergens: ['gluten', 'dairy', 'egg'], spice: 0, portion: '1 pudding', calories: 560, prep: 16,
    ingredients: ['Dark chocolate', 'Butter', 'Eggs', 'Vanilla cream'], groups: ['dessert-extras'], featured: true, recipe: [r('chocolate', 0.06), r('butter', 0.04), r('eggs', 2), r('cream', 0.03)],
  },
  {
    slug: 'cardamom-panna-cotta', category: 'desserts', motif: 'pannacotta', seed: 173,
    name: 'Cardamom Panna Cotta', description: 'Set cream scented with green cardamom, with a spiced mango compote.',
    price: 420, tags: ['vegetarian', 'gluten-free'], allergens: ['dairy'], spice: 0, portion: '1 cup', calories: 380, prep: 5,
    ingredients: ['Cream', 'Green cardamom', 'Mango'], groups: [], recipe: [r('cream', 0.1), r('mango', 0.05)],
  },
  {
    slug: 'coffee-tiramisu', category: 'desserts', motif: 'tiramisu', seed: 181,
    name: 'Coffee Tiramisu', description: 'Mascarpone cream over espresso-soaked sponge, dusted with cocoa.',
    price: 480, tags: ['vegetarian'], allergens: ['gluten', 'dairy', 'egg'], spice: 0, portion: '1 slice', calories: 470, prep: 5,
    ingredients: ['Mascarpone', 'Espresso', 'Sponge', 'Cocoa'], groups: [], recipe: [r('mascarpone', 0.08), r('coffee', 0.01), r('eggs', 1), r('flour', 0.03)],
  },
  {
    slug: 'burnt-honey-tart', category: 'desserts', motif: 'tart', seed: 191,
    name: 'Burnt Honey Tart', description: 'Buttery shortcrust, caramelised honey custard and a little flaky salt.',
    price: 440, tags: ['vegetarian'], allergens: ['gluten', 'dairy', 'egg'], spice: 0, portion: '1 slice', calories: 430, prep: 6,
    ingredients: ['Shortcrust', 'Honey', 'Cream', 'Eggs'], groups: ['dessert-extras'], recipe: [r('flour', 0.05), r('butter', 0.04), r('eggs', 2), r('cream', 0.05)],
  },
  // ------------------------------------------------------------------------------------------------ drinks
  {
    slug: 'elderflower-spritz', category: 'drinks', motif: 'spritz', seed: 199,
    name: 'Elderflower Spritz (0%)', description: 'Alcohol-free: elderflower, cucumber and lemon over ice, topped with sparkling water.',
    price: 380, tags: ['vegan', 'gluten-free', 'dairy-free'], allergens: [], spice: 0, portion: '1 glass', calories: 90, prep: 4,
    ingredients: ['Elderflower', 'Cucumber', 'Lemon', 'Sparkling water'], groups: [], recipe: [r('elderflower', 0.04), r('lemons', 0.02)],
  },
  {
    slug: 'orange-zest-cold-brew', category: 'drinks', motif: 'coldbrew', seed: 211,
    name: 'Orange Zest Cold Brew', description: 'Eighteen hours steeped, served over ice with a twist of orange zest.',
    price: 320, tags: ['vegan', 'gluten-free', 'dairy-free'], allergens: [], spice: 0, portion: '350 ml', calories: 10, prep: 3,
    ingredients: ['Coffee', 'Water', 'Orange zest'], groups: ['drink-size'], recipe: [r('coffee', 0.03)],
  },
  {
    slug: 'masala-chai', category: 'drinks', motif: 'chai', seed: 223,
    name: 'Masala Chai', description: 'Assam tea simmered with ginger, cardamom and whole milk, poured into a clay cup.',
    price: 220, tags: ['vegetarian', 'gluten-free'], allergens: ['dairy'], spice: 1, portion: '1 cup', calories: 120, prep: 5,
    ingredients: ['Assam tea', 'Ginger', 'Cardamom', 'Milk'], groups: ['drink-size'], recipe: [r('tea', 0.01), r('chai-masala', 0.005), r('milk', 0.15)],
  },
  {
    slug: 'mango-lassi', category: 'drinks', motif: 'lassi', seed: 227,
    name: 'Mango Lassi', description: 'Thick yoghurt blended with ripe mango and a pinch of cardamom.',
    price: 340, salePrice: 290, tags: ['vegetarian', 'gluten-free'], allergens: ['dairy'], spice: 0, portion: '350 ml', calories: 240, prep: 3,
    ingredients: ['Yoghurt', 'Mango', 'Cardamom'], groups: ['drink-size'], recipe: [r('yoghurt', 0.15), r('mango', 0.1)],
  },
  {
    slug: 'rosemary-tonic', category: 'drinks', motif: 'tonic', seed: 233,
    name: 'Rosemary Tonic', description: 'House tonic with rosemary and grapefruit peel over clear ice.',
    price: 360, tags: ['vegan', 'gluten-free', 'dairy-free'], allergens: [], spice: 0, portion: '1 glass', calories: 70, prep: 4,
    ingredients: ['Tonic', 'Rosemary', 'Grapefruit peel'], groups: ['drink-size'], recipe: [r('lemons', 0.03), r('herbs', 0.005)],
  },
  {
    slug: 'lemon-basil-soda', category: 'drinks', motif: 'soda', seed: 239,
    name: 'Lemon & Basil Soda', description: 'Pressed lemon, bruised basil and sparkling water. Sharp and clean.',
    price: 290, tags: ['vegan', 'gluten-free', 'dairy-free'], allergens: [], spice: 0, portion: '350 ml', calories: 60, prep: 3,
    ingredients: ['Lemon', 'Basil', 'Sparkling water'], groups: ['drink-size'], recipe: [r('lemons', 0.05), r('herbs', 0.01)],
  },
  {
    slug: 'double-espresso', category: 'drinks', motif: 'espresso', seed: 241,
    name: 'Double Espresso', description: 'Two shots of our house blend, pulled slowly. Served with a small glass of water.',
    price: 240, tags: ['vegan', 'gluten-free', 'dairy-free'], allergens: [], spice: 0, portion: '2 shots', calories: 5, prep: 3,
    ingredients: ['Coffee'], groups: [], recipe: [r('coffee', 0.018)],
  },
];
