const AMENITY_LABELS_BY_PRODUCT_ID: Record<string, string> = {
  "63d5daa9-8506-441f-8d0e-96fed8225e1b": "กาแฟ",
  "a825de0a-918b-4941-9a78-123d5ec78ffa": "น้ำดื่ม",
  "c38614e2-9498-485a-a761-b4e332e15181": "แชมพู",
  "d7241352-8194-4b8f-ad66-8dee940054d1": "สบู่",
};

const RETURNABLE_PRODUCT_ORDER = [
  "a825de0a-918b-4941-9a78-123d5ec78ffa", // น้ำดื่ม
  "63d5daa9-8506-441f-8d0e-96fed8225e1b", // กาแฟ
  "d7241352-8194-4b8f-ad66-8dee940054d1", // สบู่
  "c38614e2-9498-485a-a761-b4e332e15181", // แชมพู
];

const AMENITY_LABELS_BY_ENGLISH: Record<string, string> = {
  "bath towel": "ผ้าเช็ดตัว",
  "glass": "แก้วน้ำ",
  "shampoo": "แชมพู",
  "soap": "สบู่",
  "tissue paper": "กระดาษทิชชู่",
  "trash bin": "ถังขยะ",
  "water bottle": "น้ำดื่ม",
  "coffee": "กาแฟ",
};

const RETURNABLE_PRODUCT_ID_SET = new Set(Object.keys(AMENITY_LABELS_BY_PRODUCT_ID));
const RETURNABLE_ENGLISH_KEY_SET = new Set(["water bottle", "coffee", "soap", "shampoo"]);
const RETURNABLE_PRODUCT_ORDER_INDEX = new Map(
  RETURNABLE_PRODUCT_ORDER.map((productId, index) => [productId, index])
);

export function normalizeAmenityLabelKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function getAmenityLabelFromValues(itemName: string, productId?: string | null): string {
  if (productId && AMENITY_LABELS_BY_PRODUCT_ID[productId]) {
    return AMENITY_LABELS_BY_PRODUCT_ID[productId];
  }

  const englishKey = normalizeAmenityLabelKey(itemName);
  return AMENITY_LABELS_BY_ENGLISH[englishKey] ?? itemName;
}

export function isReturnableAmenity(input: {
  item?: string | null;
  product_id?: string | null;
}): boolean {
  const productId = typeof input.product_id === "string" ? input.product_id : null;
  if (productId && RETURNABLE_PRODUCT_ID_SET.has(productId)) {
    return true;
  }

  return RETURNABLE_ENGLISH_KEY_SET.has(normalizeAmenityLabelKey(input.item));
}

export function getReturnableAmenityProductIds(): string[] {
  return Array.from(RETURNABLE_PRODUCT_ID_SET);
}

export function compareReturnableAmenityOrder(
  left: { product_id?: string | null; item?: string | null },
  right: { product_id?: string | null; item?: string | null }
): number {
  const leftIndex = RETURNABLE_PRODUCT_ORDER_INDEX.get(String(left.product_id ?? ""));
  const rightIndex = RETURNABLE_PRODUCT_ORDER_INDEX.get(String(right.product_id ?? ""));
  if (typeof leftIndex === "number" && typeof rightIndex === "number") {
    return leftIndex - rightIndex;
  }
  if (typeof leftIndex === "number") return -1;
  if (typeof rightIndex === "number") return 1;
  return String(left.item ?? "").localeCompare(String(right.item ?? ""), "th");
}
