// Ready-made starting points when setting up a department (tap to add, then rename freely).
// Names are per language; the department's people see whatever is saved.

export type PresetGroup = "fnb" | "housekeeping" | "frontOffice" | "kitchen";

export const ROLE_PRESETS: Record<PresetGroup, Record<"bg" | "en" | "ru", string[]>> = {
  fnb: {
    bg: ["Сервитьор", "Помощник-сервитьор", "Барман", "Асистент управител", "Хост"],
    en: ["Waiter", "Helper waiter", "Bartender", "Assistant manager", "Host"],
    ru: ["Официант", "Помощник официанта", "Бармен", "Ассистент управляющего", "Хостес"],
  },
  housekeeping: {
    bg: ["Камериерка", "Перачка", "Супервайзор", "Чистач общи части"],
    en: ["Maid", "Laundry", "Supervisor", "Public area cleaner"],
    ru: ["Горничная", "Прачка", "Супервайзер", "Уборщик общих зон"],
  },
  frontOffice: {
    bg: ["Рецепционист", "Нощен рецепционист", "Портиер", "Пиколо"],
    en: ["Receptionist", "Night auditor", "Concierge", "Bellboy"],
    ru: ["Администратор", "Ночной администратор", "Консьерж", "Портье"],
  },
  kitchen: {
    bg: ["Готвач", "Помощник-готвач", "Сладкар", "Миялник"],
    en: ["Cook", "Assistant cook", "Pastry cook", "Dishwasher"],
    ru: ["Повар", "Помощник повара", "Кондитер", "Посудомойщик"],
  },
};

/** Common shift legends: code, name per language, hours. */
export const LEGEND_PRESETS: { code: string; name: Record<"bg" | "en" | "ru", string>; segments: string; breakMinutes: number; color: string }[] = [
  { code: "С", name: { bg: "Сутрин", en: "Morning", ru: "Утро" }, segments: "07:00-15:00", breakMinutes: 0, color: "#f59e0b" },
  { code: "СЛ", name: { bg: "Следобед", en: "Afternoon", ru: "День" }, segments: "15:00-23:00", breakMinutes: 0, color: "#3b82f6" },
  { code: "Н", name: { bg: "Нощ", en: "Night", ru: "Ночь" }, segments: "23:00-07:00", breakMinutes: 0, color: "#6366f1" },
  { code: "Д", name: { bg: "Дневна", en: "Day", ru: "Дневная" }, segments: "09:00-17:30", breakMinutes: 30, color: "#0ea5e9" },
];
