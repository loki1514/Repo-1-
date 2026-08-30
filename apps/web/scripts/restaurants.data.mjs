/**
 * The three demo restaurants, as data.
 *
 * Deliberately three *different shapes* of business, because that is what
 * makes the module system observable: a full-service dining hall, a small
 * counter café, and a delivery-led cloud kitchen should not produce the same
 * app. If all three looked alike, the control plane would be decorative.
 */

export const PASSWORD = "Vini@2026";

const eat = (name, price, opts = {}) => ({ name, price, course: "eat", ...opts });
const drink = (name, price, opts = {}) => ({ name, price, course: "drink", ...opts });

export const RESTAURANTS = [
  // -------------------------------------------------------------------------
  {
    slug: "mysore-dining-hall",
    name: "Mysore Dining Hall",
    type: "franchise",
    tagline: "Regional · Tasty",
    theme: { accent: "#b3282d", font: "dm-sans" },
    bill: {
      legal_name: "Mysore Dining Hall Pvt Ltd",
      address: "142, Sahakar Nagar Main Road, Bengaluru 560092",
      gstin: "29AAGCM4194K1ZP",
      fssai: "11223344556677",
      phone: "+91 80 4123 7788",
      sgst_pct: 2.5,
      cgst_pct: 2.5,
      service_charge_pct: 5,
      footer_note: "Thank you for dining with us. GST paid on food & beverages.",
    },
    // Every module — this is the reference implementation of the platform.
    modules: null,
    areas: [
      { name: "Indoor", tables: ["21", "22", "23", "24", "25", "26", "27", "28", "29", "30"] },
      { name: "Outdoor", tables: ["1", "2", "3", "4", "5", "6", "7", "8"] },
      { name: "Private Dining", tables: ["Room 1", "Room 2"] },
    ],
    stations: [
      ["main", "Hot Kitchen", "#e2564b"],
      ["tandoor", "Tandoor", "#f2a93b"],
      ["beverages", "Beverages", "#4c93e8"],
      ["dessert", "Sweets", "#a06cd5"],
    ],
    channels: [
      ["swiggy", "Swiggy", true, 22],
      ["zomato", "Zomato", true, 21],
      ["qr", "Table QR", true, 0],
      ["website", "Own Website", false, 0],
    ],
    menu: [
      {
        category: "Biriyani",
        items: [
          eat("Chicken Biriyani", 185, {
            foodType: "non_veg",
            recommended: true,
            desc: "Long-grain rice layered with Mysore-spiced chicken, served with raita and salan.",
            variants: [["Half", 185], ["Full", 269]],
            prep: 22,
          }),
          eat("Mutton Biriyani", 235, {
            foodType: "non_veg",
            desc: "Slow-cooked mutton on the bone, dum-sealed with saffron rice.",
            variants: [["Half", 235], ["Full", 349]],
            prep: 28,
          }),
          eat("Veg Biriyani", 119, {
            desc: "Seasonal vegetables, whole spices, ghee rice.",
            variants: [["Half", 119], ["Full", 179]],
            prep: 18,
          }),
        ],
      },
      {
        category: "Curries",
        items: [
          eat("Vegetable Kurma", 55, {
            recommended: true,
            desc: "Coconut and poppy-seed gravy — the dining hall standard.",
            variants: [["Half", 55], ["Full", 95]],
          }),
          eat("Palak Paneer", 165, { desc: "Cottage cheese in spinach gravy." }),
          eat("Chicken Chettinad", 215, { foodType: "non_veg", desc: "Peppery Chettinad masala." }),
          eat("Egg Curry", 135, { foodType: "egg", desc: "Country-style onion tomato gravy." }),
          eat("Dal Tadka", 125, { desc: "Yellow dal, ghee and cumin tempering." }),
        ],
      },
      {
        category: "Dining Hall Combos",
        items: [
          eat("Thatte Idli", 45, {
            recommended: true,
            desc: "Plate idli with chutney and sambar.",
            variants: [["1 Pc", 45], ["2 Pc", 85]],
            prep: 8,
          }),
          eat("Parota", 59, {
            desc: "Flaky Malabar parota.",
            variants: [["1 Pc", 59], ["2 Pc", 118]],
            station: "tandoor",
            prep: 12,
          }),
          eat("Ragi Mudde Combo", 149, { desc: "Ragi mudde with saaru and palya." }),
          eat("Sabbakki Dose", 89, { desc: "Sago dose, crisp at the edges." }),
          eat("Shevige Bath", 95, { desc: "Rice-noodle bath with coconut." }),
        ],
      },
      {
        category: "Dose · Roti · Rice",
        items: [
          eat("Masala Dose", 99, { recommended: true, desc: "Potato palya, chutney, sambar." }),
          eat("Butter Roti", 35, { station: "tandoor" }),
          eat("Ghee Rice", 129),
          eat("Curd Rice", 89),
        ],
      },
      {
        category: "Snacks",
        items: [
          eat("Mysore Bonda", 69),
          eat("Chilli Gobi", 145, { desc: "Wok-tossed cauliflower." }),
          eat("Chicken 65", 199, { foodType: "non_veg", recommended: true }),
          eat("Masala Peanuts", 79),
        ],
      },
      {
        category: "Sweets",
        items: [
          eat("Pheni", 99, { station: "dessert", desc: "Ghee-roasted, sugar-dusted." }),
          eat("Mysore Pak", 89, { station: "dessert", recommended: true }),
          eat("Gulab Jamun", 79, { station: "dessert", variants: [["2 Pc", 79], ["4 Pc", 149]] }),
        ],
      },
      {
        category: "Thalis",
        items: [
          eat("North Karnataka Thali", 289, { recommended: true, desc: "Jolada rotti, enne badanekai, palya, sweet.", prep: 20 }),
          eat("Mysore Special Thali", 249, { desc: "Rice, sambar, rasam, two palya, sweet.", prep: 18 }),
          eat("Non-Veg Thali", 359, { foodType: "non_veg", prep: 25 }),
        ],
      },
      {
        category: "Cold Beverages",
        items: [
          drink("Bottled Water", 25, { station: "beverages" }),
          drink("Masala Majige", 65, { station: "beverages", recommended: true, desc: "Spiced buttermilk, curry leaf." }),
          drink("Custard Milk", 65, { station: "beverages" }),
          drink("Limca", 49, { station: "beverages" }),
          drink("Fresh Lime Soda", 79, { station: "beverages", variants: [["Sweet", 79], ["Salted", 79]] }),
        ],
      },
      {
        category: "Hot Beverages",
        items: [
          drink("Filter Coffee", 45, { station: "beverages", recommended: true }),
          drink("Masala Chai", 35, { station: "beverages" }),
          drink("Badam Milk", 79, { station: "beverages" }),
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    slug: "brew-and-bite",
    name: "Brew & Bite Café",
    type: "franchise",
    tagline: "Counter-first neighbourhood café",
    theme: { accent: "#c98a3e", font: "poppins" },
    bill: {
      legal_name: "Brew & Bite Hospitality LLP",
      address: "7, Church Street, Bengaluru 560001",
      gstin: "29AAECB7712P1Z4",
      fssai: "22334455667788",
      phone: "+91 80 4477 1120",
      sgst_pct: 2.5,
      cgst_pct: 2.5,
      service_charge_pct: 0,
      footer_note: "No service charge. Tips go entirely to the team.",
    },
    // A counter café runs no stockroom and no CRM team — those modules are off,
    // and the sidebar loses them entirely rather than showing dead links.
    modules: { inventory: false, finance: false, marketing_crm: false },
    areas: [
      { name: "Café Floor", tables: ["C1", "C2", "C3", "C4", "C5", "C6"] },
      { name: "Counter", tables: ["Takeaway 1", "Takeaway 2"] },
    ],
    stations: [
      ["main", "Kitchen", "#e2564b"],
      ["beverages", "Bar", "#4c93e8"],
    ],
    channels: [
      ["swiggy", "Swiggy", true, 22],
      ["zomato", "Zomato", false, 21],
      ["qr", "Table QR", true, 0],
    ],
    menu: [
      {
        category: "Coffee",
        items: [
          drink("Americano", 149, { station: "beverages", recommended: true, variants: [["Regular", 149], ["Large", 189]] }),
          drink("Cappuccino", 169, { station: "beverages", recommended: true }),
          drink("Hazelnut Latte", 199, { station: "beverages" }),
          drink("Cold Brew", 189, { station: "beverages" }),
        ],
      },
      {
        category: "Hot Cafe",
        items: [
          drink("Truffle Ka Hot Chocolate", 219, { station: "beverages", desc: "Dark chocolate, sea salt." }),
          drink("Masala Chai", 89, { station: "beverages" }),
        ],
      },
      {
        category: "All Day Plates",
        items: [
          eat("Big Breakfast", 329, { foodType: "egg", recommended: true, desc: "Eggs your way, sausage, sourdough.", prep: 16 }),
          eat("Truffle Mushroom Toast", 289),
          eat("Chicken Club Sandwich", 279, { foodType: "non_veg" }),
          eat("Penne Arrabbiata", 269, { variants: [["Veg", 269], ["Chicken", 319]] }),
        ],
      },
      {
        category: "Bakes",
        items: [
          eat("Brownie", 149, { recommended: true }),
          eat("Butter Croissant", 129),
          eat("Blueberry Cheesecake", 199),
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    slug: "rooftop-all-day",
    name: "Rooftop All Day Kitchen",
    type: "franchise",
    tagline: "Delivery-led, dine-in optional",
    theme: { accent: "#2f7d63", font: "inter" },
    bill: {
      legal_name: "Rooftop Culinary Ventures Pvt Ltd",
      address: "Level 4, Nexus Mall, Koramangala, Bengaluru 560095",
      gstin: "29AABCR9931M1ZK",
      fssai: "33445566778899",
      phone: "+91 80 6699 4412",
      sgst_pct: 2.5,
      cgst_pct: 2.5,
      service_charge_pct: 10,
      footer_note: "10% service charge is discretionary — ask us to remove it.",
    },
    modules: { marketing_crm: false },
    areas: [
      { name: "Rooftop", tables: ["R1", "R2", "R3", "R4", "R5", "R6"] },
      { name: "Indoor", tables: ["I1", "I2", "I3", "I4"] },
      { name: "Delivery Desk", tables: ["Parcel 1", "Parcel 2", "Parcel 3"] },
    ],
    stations: [
      ["main", "Hot Kitchen", "#e2564b"],
      ["tandoor", "Grill", "#f2a93b"],
      ["beverages", "Bar", "#4c93e8"],
    ],
    channels: [
      ["swiggy", "Swiggy", true, 24],
      ["zomato", "Zomato", true, 23],
      ["ondc", "ONDC", true, 8],
      ["qr", "Table QR", true, 0],
      ["website", "Own Website", true, 0],
    ],
    menu: [
      {
        category: "Small Plates",
        items: [
          eat("Burrata & Heirloom Tomato", 449, { recommended: true }),
          eat("Chilli Garlic Prawns", 499, { foodType: "non_veg", station: "tandoor" }),
          eat("Peri Peri Fries", 229),
        ],
      },
      {
        category: "Grills",
        items: [
          eat("Tandoori Chicken", 549, { foodType: "non_veg", station: "tandoor", recommended: true, variants: [["Half", 549], ["Full", 899]], prep: 26 }),
          eat("Paneer Tikka", 389, { station: "tandoor" }),
          eat("Lamb Seekh Kebab", 599, { foodType: "non_veg", station: "tandoor", prep: 24 }),
        ],
      },
      {
        category: "Mains",
        items: [
          eat("Butter Chicken", 529, { foodType: "non_veg", recommended: true, prep: 22 }),
          eat("Dal Rooftop", 329),
          eat("Wild Mushroom Risotto", 469, { prep: 20 }),
        ],
      },
      {
        category: "Bar",
        items: [
          drink("Virgin Mojito", 279, { station: "beverages", recommended: true }),
          drink("Cold Pressed Orange", 229, { station: "beverages" }),
          drink("Bottled Water", 60, { station: "beverages" }),
        ],
      },
    ],
  },
];

/** Every demo login, per org. One password for all of them — it is a demo. */
export const STAFF = [
  ["owner", "org_admin", "Owner"],
  ["manager", "manager", "Manager"],
  ["biller", "biller", "Cashier"],
  ["captain", "captain", "Captain"],
  ["kitchen", "kitchen", "Kitchen"],
];
