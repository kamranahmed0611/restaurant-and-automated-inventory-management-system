import { Category, MenuItem, Modifier } from '@/types/database';

export const MENU_CATEGORIES = ['Burgers', 'Shawarma', 'Platter', 'Wraps', 'Fries', 'Deals'];

export const MENU_ITEMS: Array<Omit<MenuItem, 'category_id'> & { category_name: string }> = [
  // Burgers
  { id: 'b1', category_name: 'Burgers', name: 'Zinger Burger', price: 400, is_deal: false, is_available: true },
  { id: 'b2', category_name: 'Burgers', name: 'Crunch Burger', price: 300, is_deal: false, is_available: true },
  { id: 'b3', category_name: 'Burgers', name: 'Grill Burger', price: 700, is_deal: false, is_available: true },
  
  // Shawarma
  { id: 's1', category_name: 'Shawarma', name: 'Regular Shawarma', price: 290, is_deal: false, is_available: true },
  { id: 's2', category_name: 'Shawarma', name: 'Spicy Shawarma', price: 330, is_deal: false, is_available: true },
  
  // Platter
  { id: 'p1', category_name: 'Platter', name: 'Shawarma Platter', price: 600, is_deal: false, is_available: true },
  { id: 'p2', category_name: 'Platter', name: 'Cheese Platter', price: 800, is_deal: false, is_available: true },

  // Wraps
  { id: 'w1', category_name: 'Wraps', name: 'Grill Flip', price: 570, is_deal: false, is_available: true },
  { id: 'w2', category_name: 'Wraps', name: 'Fajita Dynamite', price: 570, is_deal: false, is_available: true },
  { id: 'w3', category_name: 'Wraps', name: 'Zinger Fillet', price: 570, is_deal: false, is_available: true },

  // Fries
  { id: 'f1', category_name: 'Fries', name: 'Regular Fries', price: 150, is_deal: false, is_available: true },
  { id: 'f2', category_name: 'Fries', name: 'Large Fries', price: 250, is_deal: false, is_available: true },
  { id: 'f3', category_name: 'Fries', name: 'Loaded Fries', price: 500, is_deal: false, is_available: true },

  // Deals
  { id: 'd1', category_name: 'Deals', name: 'Combo 1 (2 Wraps)', price: 1050, is_deal: true, is_available: true },
  { id: 'd2', category_name: 'Deals', name: 'Combo 2 (2 Zinger + 2 Drink)', price: 999, is_deal: true, is_available: true },
];

export const AVAILABLE_MODIFIERS: Modifier[] = [
  { id: 'm1', name: 'Extra Cheese Slice', price: 70, quantity_deducted: 1 },
  { id: 'm2', name: 'Extra Pita Bread', price: 70, quantity_deducted: 1 },
  { id: 'm3', name: 'Crispy Chicken Addon', price: 190, quantity_deducted: 1 },
  { id: 's1', name: 'White Sauce', price: 70, quantity_deducted: 1 },
  { id: 's2', name: 'Red Chilli', price: 70, quantity_deducted: 1 },
  { id: 's3', name: 'Mayo Dip', price: 70, quantity_deducted: 1 },
  { id: 's4', name: 'Ranch Sauce', price: 70, quantity_deducted: 1 },
  { id: 's5', name: 'BBQ Sauce', price: 70, quantity_deducted: 1 },
];

/**
 * Detects whether an item is a retail beverage or pre-packaged retail item
 * which must never have restaurant kitchen addons/modifiers (cheese slices, sauces, buns).
 */
export function isDrinkOrRetailItem(item: any, rawCategories?: any[]): boolean {
  if (!item) return false;
  const name = (item.name || item.item_name || '').toLowerCase();
  
  // Category check
  let catName = (item.category_name || '').toLowerCase();
  if (!catName && item.category_id && rawCategories) {
    const foundCat = rawCategories.find(c => c.id === item.category_id);
    if (foundCat) catName = (foundCat.name || '').toLowerCase();
  }
  
  const retailCatKeywords = ['drink', 'beverage', 'retail', 'water', 'juice', 'soda', 'cold drink', 'soft drink', 'beverages'];
  if (retailCatKeywords.some(kw => catName.includes(kw))) {
    return true;
  }
  
  const retailNameKeywords = [
    'cola', 'next', 'pepsi', 'coke', 'sprite', 'fanta', 'dew', 'mountain dew', 'sting', '7up', 'marinda', 'pakola',
    'water', 'mineral water', 'juice', 'soda', 'red bull', 'can', 'bottle', 'retail'
  ];
  if (retailNameKeywords.some(kw => name.includes(kw))) {
    return true;
  }

  return false;
}


