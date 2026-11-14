// Photographs for the menu. They come from Pexels, whose licence makes them free to use, commercially too, with no
// attribution required (credits are still listed in docs/photo-credits.md). They are linked from Pexels' own image
// service rather than stored in this repository, so the project stays small and a photo is never downloaded at full size.
//
// Pexels did not have a picture of every dish exactly as ÉLAN cooks it. Entries marked `standIn` show a close cousin of the
// dish (a pastry of the same colour and shape, a fish plate from the same river delta) and the alt text describes what the
// photograph really shows, never what the dish is. An owner can swap any of them in Admin > Menu > Edit dish > Photograph;
// any https image address works.

export const PEXELS_HOST = 'images.pexels.com';

/** The address of a Pexels photograph at a given width. Pexels resizes on its side. */
export function pexelsUrl(id, width = 1200) {
  return `https://${PEXELS_HOST}/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${width}`;
}

/** Pexels photograph id and a description of what the picture shows, by dish slug. */
export const DISH_PHOTOS = {
  // Breakfast and brunch
  'brioche-french-toast': { id: 37204652, alt: 'Golden French toast with syrup poured over it' },
  'shakshuka-labneh': { id: 29843063, alt: 'Eggs poached in a spiced tomato sauce, served in a cast-iron skillet' },
  'coconut-chia-parfait': { id: 4397286, alt: 'Chia pudding topped with almond flakes and blueberries in a glass jar' },
  'almond-croissant': { id: 37970772, alt: 'Golden almond croissants with slivered almonds on top' },

  // Starters
  'burrata-roasted-tomato': { id: 20184728, alt: 'Burrata served on a restaurant table' },
  'smoked-pumpkin-soup': { id: 29172203, alt: 'A bowl of pumpkin soup with toast and garlic' },
  'seared-scallops-cauliflower': { id: 32863869, alt: 'A gourmet scallop dish plated in its shell' },

  // Mains
  'wild-mushroom-risotto': { id: 11190138, alt: 'Creamy mushroom risotto topped with basil on a black plate' },
  'dry-aged-beef-burger': { id: 38632375, alt: 'A gourmet burger with fries on a restaurant table' },
  'tiger-prawn-linguine': { id: 725997, alt: 'Prawns on a plate of pasta' },
  'grass-fed-ribeye': { id: 6542787, alt: 'A cut ribeye steak served on a restaurant table' },
  'slow-braised-lamb-shank': { id: 30403529, alt: 'A lamb shank served with seasonal vegetables' },
  'ilish-bhapa': { id: 8743498, alt: 'Rice with fish and a wedge of lime', standIn: true },
  'dhakaiya-kacchi-biryani': { id: 9738983, alt: 'A plate of biryani garnished with lemon and tomato on a marble surface' },
  'mushroom-wellington': { id: 18884737, alt: 'A golden savoury pastry filled with spinach', standIn: true },

  // Desserts
  'dark-chocolate-fondant': { id: 36183209, alt: 'A molten chocolate cake with a melted centre, dusted with powdered sugar' },
  'cardamom-panna-cotta': { id: 14732341, alt: 'A plate with a panna cotta dessert' },
  'coffee-tiramisu': { id: 14766327, alt: 'A slice of tiramisu dusted with cocoa' },
  'burnt-honey-tart': { id: 32049683, alt: 'An elegant tartlet with a purple flower on a stone surface', standIn: true },

  // Drinks
  'elderflower-spritz': { id: 16841304, alt: 'A chilled drink in a crystal glass with a cucumber garnish', standIn: true },
  'orange-zest-cold-brew': { id: 38426418, alt: 'Iced coffee with ice cubes in a clear glass on a marble surface' },
  'masala-chai': { id: 20270270, alt: 'Masala chai in clay cups with ginger and cardamom' },
  'mango-lassi': { id: 14509267, alt: 'Two glasses of creamy mango lassi with diced mango and cinnamon sticks' },
  'rosemary-tonic': { id: 5947027, alt: 'A cold drink with a slice of lemon and a sprig of rosemary on marble' },
  'lemon-basil-soda': { id: 33107433, alt: 'A glass of chilled lemonade with lemon slices and fresh herbs', standIn: true },
  'double-espresso': { id: 40357818, alt: 'Freshly brewed espresso in a white cup on a marble surface' },
};

/** The `images` array a dish is stored with: one photograph, or none when the slug has no entry above. */
export function dishImages(slug) {
  const photo = DISH_PHOTOS[slug];
  return photo ? [{ url: pexelsUrl(photo.id), alt: photo.alt }] : [];
}
