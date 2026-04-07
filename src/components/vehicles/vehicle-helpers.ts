import { VehicleColor, VehicleType } from "@/lib/types";

/**
 * Formats plate for capsule display as per D1.
 * CAR-XXXX (4 digits), MOTO-XXX (3 digits), or BICYCLE.
 */
export function getPlateDisplay(plate: string | null, type: VehicleType): string {
  if (type === 'bicycle') return "BICYCLE";
  if (!plate) return type === 'car' ? "CAR-????" : "MOTO-???";
  
  const prefix = type === 'car' ? "CAR-" : "MOTO-";
  const count = type === 'car' ? 4 : 3;
  
  // Extract trailing digits
  const digits = plate.replace(/\D/g, '');
  
  if (!digits) {
    const lastPart = plate.slice(-count).toUpperCase();
    return `${prefix}${lastPart}`;
  }
  
  const lastDigits = digits.slice(-count);
  // Pad with zeros if fewer than digits (edge case)
  const padded = lastDigits.padStart(count, '0');
  
  return `${prefix}${padded}`;
}

/**
 * Maps vehicle color to Tailwind/CSS classes.
 * Strictly follows D3 Color System.
 */
export function getVehicleToneClasses(color: VehicleColor) {
  switch (color) {
    case 'white':
      return "bg-white text-slate-900 border-slate-300 dark:bg-slate-200 dark:border-slate-400";
    case 'black':
      return "bg-slate-900 text-white border-slate-800 dark:bg-slate-800 dark:border-slate-700";
    case 'silver':
      return "bg-slate-400 text-white border-slate-500 dark:bg-slate-500 dark:border-slate-600";
    case 'red':
      return "bg-rose-500 text-white border-rose-600 dark:bg-rose-600 dark:border-rose-700";
    case 'blue':
      return "bg-blue-500 text-white border-blue-600 dark:bg-blue-600 dark:border-blue-700";
    case 'yellow':
      return "bg-amber-400 text-slate-900 border-amber-500 dark:bg-amber-500 dark:border-amber-600";
    case 'other':
    default:
      // Purple-to-pink gradient for "Other" as per D3
      return "bg-gradient-to-r from-purple-400 to-pink-400 dark:from-purple-600 dark:to-pink-600 text-white border-transparent";
  }
}

export function getVehicleColorClasses(color: VehicleColor, isDot = false) {
  const base = isDot ? "w-3 h-3 rounded-sm border" : "rounded-full px-2 py-0.5 text-[10px] font-bold border";
  return `${base} ${getVehicleToneClasses(color)}`;
}

/**
 * Returns Hex or Var for custom dots if needed for specialized components.
 */
export function getVehicleColorStyle(color: VehicleColor) {
  switch (color) {
    case 'white': return { backgroundColor: '#ffffff', borderColor: '#d1d5db' };
    case 'black': return { backgroundColor: '#0f172a', borderColor: '#1e293b' };
    case 'silver': return { backgroundColor: '#94a3b8', borderColor: '#64748b' };
    case 'red': return { backgroundColor: '#ef4444', borderColor: '#dc2626' };
    case 'blue': return { backgroundColor: '#3b82f6', borderColor: '#2563eb' };
    case 'yellow': return { backgroundColor: '#eab308', borderColor: '#ca8a04' };
    case 'other': return { 
      background: 'linear-gradient(135deg, #a855f7, #ec4899)',
      borderColor: 'transparent'
    };
    default: return {};
  }
}
