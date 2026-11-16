export type IconName = "pin" | "train" | "saved" | "settings" | "search" | "locate" | "back" | "close" | "chevron";

const paths: Record<IconName, string> = {
  pin: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM9 10a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  train: "M7 18h10a2 2 0 0 0 2-2V6a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v10a2 2 0 0 0 2 2ZM5 11h14M8 18l-2 3m10-3 2 3M8 15h.01M16 15h.01",
  saved: "M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16l-6-4-6 4Z",
  settings: "M9 3h6l.7 3 2.8 1 2.5 2-1.5 3 1.5 3-2.5 2-2.8 1-.7 3H9l-.7-3-2.8-1L3 15l1.5-3L3 9l2.5-2 2.8-1L9 3Zm0 9a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  locate: "M12 2v3m0 14v3M2 12h3m14 0h3M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-10 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  back: "m15 18-6-6 6-6M9 12h12",
  close: "m6 6 12 12M6 18 18 6",
  chevron: "m9 5 7 7-7 7",
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
